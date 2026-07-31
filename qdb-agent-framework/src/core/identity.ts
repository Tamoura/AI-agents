/**
 * Agent Workload Identity — per-agent non-human identity (NHI) and the
 * confused-deputy guard (PRODUCTION-PLAYBOOK §3.1).
 *
 * Each agent authenticates to tool backends as ITSELF, never with a shared key
 * or the calling user's credentials. Tool backends then authorize on the pair
 * (agent identity ∧ user entitlement) so an agent can never do FOR a user what
 * that user could not do ALONE — the classic confused-deputy prevention.
 *
 * `LocalIdentityProvider` is the reference implementation: short-lived,
 * in-memory tokens. In production this is replaced by Entra ID managed
 * identities / workload identity federation — the INTERFACE is what the rest of
 * the framework depends on, so that swap touches only this file.
 */

import { createHmac, randomBytes } from "node:crypto";
import { type Result, Ok, Err, ErrorCodes } from "./types.js";

export interface AgentIdentity {
  readonly agentId: string;
  /** Opaque bearer token presented to tool backends. Short-lived by design. */
  readonly token: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export interface IdentityProvider {
  /** Issue a fresh short-lived workload identity for an agent. */
  issue(agentId: string): Result<AgentIdentity>;
  /** Verify a presented token and return the agent it belongs to. */
  verify(token: string): Result<{ agentId: string }>;
  /** Revoke all identities for an agent (offboarding / kill switch). */
  revoke(agentId: string): void;
}

const DEFAULT_TTL_MS = 15 * 60 * 1000; // 15 minutes — short-lived credentials only.

export class LocalIdentityProvider implements IdentityProvider {
  private readonly secret: Buffer;
  private readonly ttlMs: number;
  /** agentId → set of currently-valid token signatures. */
  private readonly active = new Map<string, Set<string>>();

  constructor(opts?: { secret?: Buffer; ttlMs?: number }) {
    this.secret = opts?.secret ?? randomBytes(32);
    this.ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS;
  }

  issue(agentId: string): Result<AgentIdentity> {
    if (!agentId) {
      return Err({ code: ErrorCodes.TOOL_VALIDATION_FAILED, message: "agentId is required to issue an identity." });
    }
    const issuedAt = Date.now();
    const expiresAt = issuedAt + this.ttlMs;
    const nonce = randomBytes(12).toString("hex");
    const payload = `${agentId}.${expiresAt}.${nonce}`;
    const sig = this.sign(payload);
    const token = `${payload}.${sig}`;

    const set = this.active.get(agentId) ?? new Set<string>();
    set.add(sig);
    this.active.set(agentId, set);

    return Ok({ agentId, token, issuedAt, expiresAt });
  }

  verify(token: string): Result<{ agentId: string }> {
    const parts = token.split(".");
    if (parts.length !== 4) {
      return Err({ code: ErrorCodes.TOOL_UNAUTHORIZED, message: "Malformed agent identity token." });
    }
    const [agentId, expiresAtStr, nonce, sig] = parts as [string, string, string, string];
    const expected = this.sign(`${agentId}.${expiresAtStr}.${nonce}`);
    if (sig !== expected) {
      return Err({ code: ErrorCodes.TOOL_UNAUTHORIZED, message: "Invalid agent identity signature." });
    }
    if (Date.now() > Number(expiresAtStr)) {
      return Err({ code: ErrorCodes.TOOL_UNAUTHORIZED, message: "Agent identity token has expired." });
    }
    if (!this.active.get(agentId)?.has(sig)) {
      return Err({ code: ErrorCodes.TOOL_UNAUTHORIZED, message: "Agent identity has been revoked." });
    }
    return Ok({ agentId });
  }

  revoke(agentId: string): void {
    this.active.delete(agentId);
  }

  private sign(payload: string): string {
    return createHmac("sha256", this.secret).update(payload).digest("hex");
  }
}

/**
 * Confused-deputy guard. When a tool declares a required entitlement, the
 * REQUESTING USER must hold it — the agent's own authorization is necessary but
 * not sufficient. Returns Ok only when both legs pass.
 */
export function assertUserEntitled(
  requiredEntitlement: string | undefined,
  userEntitlements: readonly string[] | undefined,
): Result<void> {
  if (!requiredEntitlement) return Ok(undefined); // Tool needs no user-level entitlement.
  if (userEntitlements?.includes(requiredEntitlement)) return Ok(undefined);
  return Err({
    code: ErrorCodes.TOOL_UNAUTHORIZED,
    message: `Confused-deputy prevention: the requesting user lacks the "${requiredEntitlement}" entitlement this tool requires.`,
  });
}

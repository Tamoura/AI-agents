import { describe, it, expect } from "vitest";
import { LocalIdentityProvider, assertUserEntitled } from "../../src/core/identity.js";

describe("LocalIdentityProvider", () => {
  it("issues a token that verifies back to the same agent", () => {
    const idp = new LocalIdentityProvider();
    const issued = idp.issue("it_operations");
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;
    const verified = idp.verify(issued.value.token);
    expect(verified.ok).toBe(true);
    if (verified.ok) expect(verified.value.agentId).toBe("it_operations");
  });

  it("rejects a tampered token", () => {
    const idp = new LocalIdentityProvider();
    const issued = idp.issue("pmo_delivery");
    if (!issued.ok) throw new Error("issue failed");
    const tampered = issued.value.token.replace("pmo_delivery", "core_banking_agent");
    const verified = idp.verify(tampered);
    expect(verified.ok).toBe(false);
  });

  it("rejects an expired token", async () => {
    const idp = new LocalIdentityProvider({ ttlMs: 1 });
    const issued = idp.issue("it_operations");
    if (!issued.ok) throw new Error("issue failed");
    await new Promise((r) => setTimeout(r, 5));
    expect(idp.verify(issued.value.token).ok).toBe(false);
  });

  it("rejects a revoked agent's token (kill switch)", () => {
    const idp = new LocalIdentityProvider();
    const issued = idp.issue("it_operations");
    if (!issued.ok) throw new Error("issue failed");
    idp.revoke("it_operations");
    const verified = idp.verify(issued.value.token);
    expect(verified.ok).toBe(false);
    expect(verified.ok === false && verified.error.message).toMatch(/revoked/);
  });

  it("rejects a malformed token", () => {
    const idp = new LocalIdentityProvider();
    expect(idp.verify("not-a-real-token").ok).toBe(false);
  });
});

describe("assertUserEntitled (confused-deputy guard)", () => {
  it("passes when the tool needs no entitlement", () => {
    expect(assertUserEntitled(undefined, []).ok).toBe(true);
  });
  it("passes when the user holds the required entitlement", () => {
    expect(assertUserEntitled("credit.write", ["credit.read", "credit.write"]).ok).toBe(true);
  });
  it("fails when the user lacks the required entitlement", () => {
    const r = assertUserEntitled("credit.write", ["credit.read"]);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error.message).toMatch(/lacks/);
  });
  it("fails when the user has no entitlements at all", () => {
    expect(assertUserEntitled("credit.write", undefined).ok).toBe(false);
  });
});

# Labs

Hands-on exercises from the curriculum (`docs/LEARNING-PATH.md`). Work each on a
personal branch (`learn/<name>/<level>`); the gate is a reviewed, passing artifact
— you pass by shipping, not by reading. Many labs' outputs become real assets
(the eval harness, governance templates), so build them for keeps.

## Where each lab lives (it's the real codebase)

| Lab | Curriculum | Build against |
|---|---|---|
| Add a tool + allowlist-denial test (**L1 gate**) | M1.3 | `src/tools/`, `src/core/tool-registry.ts`, `tests/` |
| Schema-validated extractor with retry | M1.4 | `src/core/structured-output.ts` |
| RAG with citations + honest refusal | M1.5 | `src/core/retrieval.ts` (reference impl to extend) |
| Build the `procurement` specialist agent (**L2 gate**) | M2.1–2.5 | `src/agents/`, `policies/`, `src/agents/router/` |
| Checkpointed 3-node graph | M2.2 | `src/core/graph-engine.ts` |
| Approval round-trip (approve + reject) | M2.5 | `src/governance/escalation.ts`, `src/api/routes/admin.ts` |
| Golden dataset + adversarial suite in CI (**L3 flagship**) | M3.1–3.2 | `evals/` (extend the datasets + runner) |
| Jaeger traces + per-agent dashboard | M3.5 | `src/core/observability.ts`, `docker-compose.yml` |
| Reconstruction drill | M3.5 | audit route + `npm run simulate` |
| Injection runbook + tabletop | M3.6 | `docs/runbooks/` (template + worked example) |
| Threat model + red-team | M4.1–4.3 | `src/core/guardrails.ts`, `tests/governance/adversarial.test.ts` |
| Strengthen a guardrail (Arabic PII) | M4.2 | `src/core/guardrails.ts` (`normalizeForDetection`) |
| Governance artifacts adopted | M4.4–4.6 | `docs/templates/` (charter, evidence pack, validation checklist) |

## Starter: the L1 gate

The first shippable milestone (M1.3). Add a mock tool, register it with correct
`operationType` and classification ceiling, add it to one agent's allowlist, and
prove with a test that (a) the authorized agent can call it, (b) another agent is
denied, (c) the call emits an audit event. Model it on `src/tools/data/search-ecm.ts`
and the authorization path in `src/core/tool-registry.ts`; assert denial with
`ErrorCodes.TOOL_UNAUTHORIZED`. Green test, reviewed by an L2+ → gate passed.

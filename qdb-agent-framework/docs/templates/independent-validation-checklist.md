# Independent Validation Checklist

> Template (LEARNING-PATH M4.4; PRODUCTION-PLAYBOOK §5.2). Completed by the risk
> function — organizationally SEPARATE from the team that built the agent, exactly
> as model validation is separate from model development. Attach to the evidence
> pack before any deployment or promotion.

**Agent / task category:** ______  **Requested level:** ______  **Validator:** ______  **Date:** ______

## Scope & accountability
- [ ] Policy file has a named `owner_team`; a specific human owner is identified.
- [ ] Scope statement matches what the agent's tools and data ceiling actually allow.
- [ ] Bounded-blast-radius analysis is present and correct (tools × ceiling × autonomy).

## Controls
- [ ] Tool allowlist is least-privilege; each tool has a justification.
- [ ] Data-classification ceiling is appropriate; PII handling mode is set.
- [ ] Hard rules intact: MUTATE + CONFIDENTIAL/RESTRICTED → human approval, non-overridable.
- [ ] Escalation routes to named roles with full context.
- [ ] Guardrails cover input, output, tool-call, and behavioral limits (incl. Arabic).

## Evidence quality
- [ ] Golden dataset is owner-curated, representative, and of adequate size (N stated).
- [ ] Adversarial suite passes at 100% across ≥2 model versions (for L3+).
- [ ] KPI history supports the promotion signal (override rate, escalation precision).
- [ ] Every past incident became a regression case.

## Observability & reversibility
- [ ] Audit events capture policy version + model ID in force.
- [ ] Reconstruction drill passed (full causal chain from logs, < 1 hour).
- [ ] Rollback plan exists and has been drilled; time recorded.
- [ ] Dashboards + behavioral alerts live for this agent.

## Regulatory
- [ ] QCB / PDPPL / Sharia obligations relevant to this category are mapped to controls.
- [ ] Data residency: CONFIDENTIAL+ inference stays in-region.

## Disposition
- [ ] Recommend approval  [ ] Approval with conditions  [ ] Do not approve
**Findings / conditions:**
**Validator signature / date:**

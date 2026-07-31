# Runbook: Suspected injection → unauthorized READ of confidential data

> Worked example (LEARNING-PATH M3.6). Tabletop this with the security track.
> The scenario: a prompt injection (likely indirect — hidden in a retrieved
> document or tool result) caused an agent to read CONFIDENTIAL data it should
> not have surfaced.

**Incident class:** data boundary crossed / suspected prompt-injection exploitation
**Severity mapping:** map to bank Sev-1/Sev-2 by data volume and sensitivity
**Owner team:** the affected agent's owner team + Information Security

## Detection signals
- Guardrail-BLOCK spike or an anomalous escalation-rate jump (behavioral alert, §8.2).
- Audit shows an agent retrieving above its usual classification, or a tool call
  pattern inconsistent with the user's request.
- `withheldForClassification` unexpectedly zero where confidential content was returned.
- User or reviewer reports seeing data they shouldn't.

## Immediate containment (first 15 minutes)
1. **Autonomy downgrade** the implicated agent to L0 (config flag, no deploy) —
   owner team or security may invoke; committee ratifies. If exfiltration to an
   external channel is suspected, **per-agent disable** instead.
2. Revoke the agent's workload identity (`IdentityProvider.revoke`) to cut its
   tool access immediately.
3. Preserve evidence: do NOT clear session state or the audit trail.

## Diagnosis
1. Pull the full causal chain by `correlationId` (audit query / audit route).
2. Identify the injection vector: which retrieved document / tool result / user
   input carried the instruction. Treat all retrieved content as the suspect first.
3. Determine blast radius: which records were read, whether any left the system
   (output guardrail logs, external tool calls), which users were affected.
4. Confirm whether policy version + model ID in force match expectations.

## Reportability
- Personal data exposed → **PDPPL** breach assessment and notification timeline.
- Material operational incident → **QCB** operational-incident reporting.
- **NCSA/NIA** report if it meets the national threshold.
- Notification matrix: DPO, CISO, affected agent owner, committee chair — timeline
  per the bank's breach policy.

## Remediation
1. Close the vector: add/adjust the guardrail (injection pattern, or move the
   content into clearly-delimited untrusted context), tighten the tool allowlist
   or the tool's `requiredEntitlement`, or lower the agent's data ceiling.
2. If a model behavior enabled it, evaluate a re-pin in shadow before cutover.
3. Verify the fix with a new adversarial eval case (below) before restoring autonomy.

## Post-incident
- [ ] Add the exact injection string to `evals/adversarial/` — it must now fail safely.
- [ ] Add a golden case covering the correct refusal/escalation.
- [ ] Update this runbook with anything the drill or incident revealed.
- [ ] Report to the governance committee with root cause and the regression cases added.
- [ ] Restore autonomy only via the normal promotion path once evidence is green.

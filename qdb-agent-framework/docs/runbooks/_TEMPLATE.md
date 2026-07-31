# Runbook: <Incident Class>

> Template for agent incident runbooks (LEARNING-PATH M3.6; PRODUCTION-PLAYBOOK
> §9.2). One runbook per incident class; test each in a tabletop drill; store
> next to the code. Keep it to a page a responder can follow at 2am.

**Incident class:** _e.g. unauthorized action executed_
**Severity mapping:** _map to the bank's incident-management severities_
**Owner team:** ______

## Detection signals
What tells you this is happening (metric spike, alert name, audit pattern, user report).

## Immediate containment (first 15 minutes)
1. Which kill-switch level applies (per-agent disable / autonomy downgrade / global stop) and who may pull it.
2. Preserve evidence (do not wipe the audit trail or session state).

## Diagnosis
Steps to confirm scope: reconstruct the causal chain from logs (correlationId),
identify affected users/data, determine blast radius.

## Reportability
Is this also a reportable event? (PDPPL personal-data breach, QCB operational
incident, NCSA report). Notification matrix: who, by when.

## Remediation
Fix the root cause: policy/guardrail change, model re-pin, rollback. Follow
change control.

## Post-incident
- [ ] Add a regression case to `evals/` (every incident becomes a test).
- [ ] Update this runbook with what was missing.
- [ ] Report to the governance committee.

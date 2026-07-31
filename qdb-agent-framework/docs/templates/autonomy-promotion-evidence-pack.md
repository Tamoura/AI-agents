# Autonomy-Promotion Evidence Pack

> Template — the recurring governance artifact that moves ONE task category up
> the autonomy ladder (PRODUCTION-PLAYBOOK §4.2, §10; LEARNING-PATH M4.6).
> Autonomy is earned per task category, not granted per agent. Fill every
> section; a section marked N/A needs a one-line reason. Synthetic or
> simulate-derived data must be labelled as such.

## 1. Identification
- **Agent / task category:** _e.g. it_operations / "P3 ticket triage"_
- **Current level → requested level:** _e.g. L2_APPROVE → L3_AUTONOMOUS_
- **Owner team & named owner:**
- **Prepared by / date:**
- **Policy version in force:** _(must match `policies/<agent>.yaml`)_
- **Model pin in force:**

## 2. Scope statement
What this category does and does NOT cover. The exact operations, tools, and
data classifications involved. What stays out of scope at the new level.

## 3. Bounded-blast-radius analysis
Worst case if fully compromised at the requested level = allowed tools ×
data-classification ceiling × autonomy ceiling. State it explicitly.

## 4. Evaluation evidence
| Suite | N | Pass rate | Floor | Date |
|---|---|---|---|---|
| Golden (this category) | | | | |
| Adversarial (relevant classes) | | 100% | 100% | |

- Link to eval run output (`npm run eval -- --json`).
- Judge-tier results if used, with calibration date.

## 5. KPI history (production or shadow)
| Metric | Baseline | Latest | Window | Trend |
|---|---|---|---|---|
| Task success rate | | | | |
| Escalation precision/recall | | | | |
| Human-override rate (approvals modified/rejected) | | | | |
| Guardrail-block rate | | | | |
| Cost per task | | | | |

**Promotion signal:** sustained >95% unmodified-approval rate for this category
over the review window (state the window and the number).

## 6. Incident record
Every incident touching this category since last review: what, root cause, the
regression case added, current status.

## 7. Red-team status
Latest adversarial exercise date, classes exercised, surviving-risk statement,
new cases contributed to `evals/adversarial/`.

## 8. Rollback plan
Exact steps and expected time to return to the previous level (previous policy
version + model pin). When was rollback last drilled?

## 9. Independent validation
Reviewer (must be organizationally separate from the builders), findings,
disposition.

## 10. Decision
- [ ] Approved to requested level  [ ] Approved with conditions  [ ] Declined
- **Conditions / rationale:**
- **Governance committee sign-off (names, date):**
- **Next review date:**

# Use-Case Portfolio — Scorecard

> Template (LEARNING-PATH M5.1; PRODUCTION-PLAYBOOK §2.3, §5.3, §10). One scorecard per
> portfolio review. Fix the weights in §2 *before* anyone scores a candidate, and keep
> superseded versions: the governance committee reads the history, not just the ranking.

## 1. Header
- **Portfolio owner:** _name, role_
- **Review date / version:**
- **Business units consulted:** _at least three_
- **Reviewers:** _(proto-)governance committee member(s), process owner(s)_

## 2. Scoring rubric and weights
Fixed before scoring. Each criterion is scored 1–5; the weighted total ranks candidates.

| Criterion | 1 means | 5 means | Weight | Why this weight |
|---|---|---|---|---|
| Volume | a few cases a month | hundreds a day | | |
| Risk (inverted) | a wrong action moves money, customer data or regulatory filings | a wrong action is cheap and reversible | | |
| Measurability | no baseline, no agreed "correct" | measured baseline and a golden set can be written | | |
| Data-readiness | data scattered, unclassified, no API | classified sources reachable through read-only tools | | |

## 3. Candidate long-list
At least 10 candidates. Include the three processes already modeled in `policies/`
(IT incident triage, PMO status reporting, credit-assessment support) as calibration points.

| # | Process | Business unit | Vol | Risk | Meas | Data | Weighted total | §5.3 worst case | Starting autonomy (L0–L4) | Pattern rung (M2.1) |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | IT incident triage | IT | | | | | | | | |
| 2 | PMO status reporting | PMO | | | | | | | | |
| 3 | Credit-assessment support | Credit Risk | | | | | | | | |
| 4 | | | | | | | | | | |

## 4. Cost model — top three
Per task, against the measured cost of today's process.

| Cost line | Candidate A | Candidate B | Candidate C | Source |
|---|---|---|---|---|
| Tokens per task (input/output, incl. Arabic multiplier) | | | | M2.6 measurement or `llm_tokens_total` |
| Model cost per task | | | | provider price sheet, date |
| Infrastructure per month (allocated) | | | | |
| Oversight minutes per task (expected approvals × 2 min) | | | | |
| Oversight cost per task | | | | loaded staff rate |
| **Total cost per task** | | | | |
| **Today's cost per task** | | | | baseline measurement |
| Tasks per month at target volume | | | | |

## 5. Phase mapping
Each transition is an evidence review, not a date (Playbook §10).

| Candidate | Playbook §10 phase | Entry gate (evidence required) | Gate owner | Target review |
|---|---|---|---|---|
| | | | | |

## 6. Sensitivity check
Move each weight by ±1 and re-rank. Does the top three change?

| Weight changed | New top three | Changed? |
|---|---|---|
| Volume +1 / −1 | | |
| Risk +1 / −1 | | |
| Measurability +1 / −1 | | |
| Data-readiness +1 / −1 | | |

**Conclusion:** _state plainly whether the ranking is robust, and which candidate is fragile._

## 7. Decision
- **Capstone / first-build process:**
- **Baseline-measurement plan:** _what is measured, by whom, over what window_
- **Candidates deferred and why:**
- **Committee reviewer sign-off (name, date):**
- **Process owner sign-off (name, date):**

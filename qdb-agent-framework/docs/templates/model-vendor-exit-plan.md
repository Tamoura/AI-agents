# Model and Vendor — Exit Plan

> Template (LEARNING-PATH M5.3; PRODUCTION-PLAYBOOK §2.3, §5.1 QCB exit-strategy row, §9).
> One plan per model provider the program depends on. Re-run the exit drill at least
> annually and whenever a pinned model gets a retirement date.

## 1. Header
- **Provider:**
- **Plan owner:**
- **Version / date:**
- **Reviewed by:** _security, procurement / legal_

## 2. Pin inventory
Every model identifier the framework uses: provider `defaultModel` values in `src/index.ts`,
`CLASSIFICATION_RULE` / `REASONING_RULE` in `src/core/llm-router.ts`, the default in
`src/core/agent-runtime.ts`.

| Where (file:symbol) | Identifier | Dated pin or alias | Agents / paths using it | Announced retirement | Justification if alias |
|---|---|---|---|---|---|
| | | | | | |

**Decision:** _do pins stay in code, or move into `policies/*.yaml` as part of the release unit (M3.3)? Why?_

## 3. Evaluation matrix
Primary provider against at least one alternate, including a Qatar-resident or local option.

| Criterion | Primary | Alternate 1 | Alternate 2 (local / resident) | Evidence |
|---|---|---|---|---|
| Task-eval pass rate (model-backed suites, M3.1) | | | | run ID, date |
| Escalation precision / recall | | | | |
| Arabic-quality eval | | | | |
| Inference residency | | | | |
| DPA in place | | | | |
| No-training clause | | | | |
| Data retention | | | | |
| SLA (availability, support) | | | | |
| Deprecation notice period | | | | |
| Cost per task (incl. Arabic token multiplier) | | | | |

If no model-backed task evals exist yet, record that here as finding #1.

## 4. Exit triggers

| Trigger | Threshold | Who detects it | Who decides to exit |
|---|---|---|---|
| Model deprecation announced | | | |
| Residency or contract change | | | |
| Price change | | | |
| Sustained outage | | | |
| Regulatory instruction | | | |

## 5. Switch plan
- **Target alternate:**
- **Switch mechanism:** _router provider config and fallback order — configuration, not a rewrite_
- **Tolerated eval gap:** _maximum drop per suite before the switch is blocked_
- **Timeline:** _from decision to all agents on the alternate_
- **Autonomy during the switch:** _e.g. drop to L1 until evals on the alternate pass_
- **Owner:**

## 6. Exit-drill record

| Date | Agent / path re-pointed | Alternate | Suites run | Primary result | Alternate result | Gap | Within tolerance? | Actions |
|---|---|---|---|---|---|---|---|---|
| | | | | | | | | |

## 7. Sign-off
- **Security (name, date):**
- **Procurement / legal (name, date):**
- **Plan owner (name, date):**
- **Next drill due:**

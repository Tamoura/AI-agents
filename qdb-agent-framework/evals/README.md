# Evals

Deterministic behavioral evaluation for the framework — the cheapest, most
objective eval tier (curriculum M3.1 assertion hierarchy). Runs in CI and gates
merges: a suite below its pass-rate floor exits non-zero.

```bash
npm run eval           # run all suites, human-readable
npm run eval -- --json # machine-readable summary (for dashboards)
```

## Suites

| Suite | Dataset | Floor | What it checks |
|---|---|---|---|
| `router` | `datasets/router-golden.jsonl` | 90% | utterance → correct target agent; out-of-scope → low confidence (not a confident wrong answer) |
| `adversarial` | `datasets/adversarial.jsonl` | 100% | injection / SQLi / PII-leak / classification-escalation attacks fail safely; benign inputs (incl. Arabic) are not blocked |

## Adding cases

Datasets are JSONL — one case per line. Add real, anonymized examples; the owner
team curates the golden set and refreshes it quarterly. **Every production
incident becomes a regression case here** (M3.6). Adversarial cases discovered in
red-team exercises (M4.3) are added to `datasets/adversarial.jsonl` and must
stay at 100%.

Router case: `{"id","utterance","expect":{"targetAgent"}}` or
`{"expect":{"lowConfidence":true}}` for out-of-scope.
Adversarial case: `{"id","input","direction":"input|output","expect":{"blocked"|"flagged":true,"rule"}}`.

## What this is not

These are deterministic assertions on the guardrail and router layers. LLM-as-judge
(groundedness, tone) and human-eval tiers layer on top before any autonomy
promotion — see PRODUCTION-PLAYBOOK §6 and the curriculum's L3.

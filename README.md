# AI Agents — QDB Agent Framework & Program

A reference implementation and complete program for running **agentic AI in
production at a regulated financial institution** — agents as governed digital
employees, with the security, evaluation, governance, and observability a bank
(and its regulator) requires.

## What's here

| Path | What it is |
|---|---|
| [`qdb-agent-framework/`](qdb-agent-framework/) | The runnable reference framework: governed multi-agent runtime (policy engine, escalation, audit, guardrails, identity), tools, HTTP API, evals, and tests. |
| [`qdb-agent-framework/docs/PRODUCTION-PLAYBOOK.md`](qdb-agent-framework/docs/PRODUCTION-PLAYBOOK.md) | The *what and why*: build · secure · communicate · govern · evaluate · guardrail · observe · version, mapped to the code, with the QCB / PDPPL / Sharia / EU-AI-Act regulatory stack. |
| [`qdb-agent-framework/docs/LEARNING-PATH.md`](qdb-agent-framework/docs/LEARNING-PATH.md) | Zero-to-hero curriculum (L0 Literate → L5 Program Lead), 28 modules with hands-on labs against this framework. |
| [`qdb-agent-framework/docs/assessment.html`](qdb-agent-framework/docs/assessment.html) | Interactive skills assessment: knowledge check + evidence gates → per-discipline ratings, role-target gaps, personalized plan, and a team-aggregation view. |
| `docs/*.html` | Self-contained HTML builds of the playbook and curriculum (diagrams pre-rendered). Regenerate with `npm run docs:html`. |

## Quick start

```bash
cd qdb-agent-framework
npm install
npm test          # unit + governance tests
npm run eval      # golden + adversarial eval suites (CI gate)
npm run simulate  # end-to-end governed workflow
npm run dev       # start the HTTP API
```

## The core idea

**Deterministic governance around non-deterministic reasoning.** The model
decides *what to say and which tool to request*; plain code decides *whether it
is allowed to* — policy enforcement, escalation, audit, and identity are code,
never the prompt. You cannot certify a prompt; you can certify an enforcement
engine. Every agent has a named human owner, an autonomy ceiling it earns with
evidence, and an audit trail that can reconstruct any decision after the fact.

## Contributing / change control

`policies/` and `docs/` changes follow review — the git history is the
regulator-facing change record (PRODUCTION-PLAYBOOK §9). CI (`.github/workflows/ci.yml`)
runs typecheck, tests, and evals on every PR to `main`; a prompt, policy, tool,
or model change is a code change and does not merge red.

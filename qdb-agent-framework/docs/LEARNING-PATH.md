# Agentic AI: Zero-to-Hero Learning Path

**A leveled curriculum for building, architecting, securing, governing, deploying, and observing AI agents in production — calibrated for a regulated financial institution (QDB).**

Companion to `PRODUCTION-PLAYBOOK.md` (the *what and why*); this document is the *how do I get my people there*. The `qdb-agent-framework` in this repo is the lab: every level ends with hands-on exercises against real code, so learning is verified by working software, not certificates.

---

## How to Use This Path

### The levels

| Level | Name | Who reaches it | Rough effort |
|---|---|---|---|
| **L0** | Literate | Everyone touching the program (incl. leadership) | 1–2 weeks part-time |
| **L1** | Builder | Developers | 3–4 weeks |
| **L2** | Agent Engineer | Developers, solution architects | 4–6 weeks |
| **L3** | Production Engineer | Senior devs, DevOps/SRE, QA | 4–6 weeks |
| **L4** | Regulated-AI Specialist | Security, risk, compliance + senior engineers | 4–6 weeks |
| **L5** | Hero / Program Lead | Tech leads, chief architect | ongoing + capstone |

### Role tracks (which levels, in which depth)

| Role | L0 | L1 | L2 | L3 | L4 | L5 |
|---|---|---|---|---|---|---|
| Developer | ● | ● | ● | ● | ○ | — |
| Solution / Enterprise Architect | ● | ● | ● | ○ | ● | ● |
| DevOps / SRE | ● | ○ | ○ | ● | ○ | — |
| Security engineer | ● | ○ | ○ | ○ | ● | — |
| Risk / Compliance / Audit | ● | — | ○ | — | ● | — |
| QA / Test engineer | ● | ● | ○ | ● | ○ | — |
| Product owner / PMO | ● | ○ | — | — | ○ | — |
| CIO / CEO / Board | ● (exec cut) | — | — | — | ○ (governance modules) | — |

● = full depth  ○ = survey depth (read + demos, skip deep exercises)

### Ground rules

1. **Every level has a gate.** You pass by shipping the exercise, not by watching the videos. Gates are listed at the end of each level.
2. **This repo is the lab.** Exercises modify or extend `qdb-agent-framework` on personal branches. Reading someone else's agent framework is L0; changing one safely is L2+.
3. **Pairing beats courses.** Run levels as cohorts (4–8 people) with a weekly 90-minute session: 30 min concepts, 60 min lab.
4. **Resources are named, not linked-to-death.** Primary sources: Anthropic docs (docs.anthropic.com), OpenAI docs, OWASP, NIST — search the named title; URLs rot, titles don't.

---

## Level 0 — Literate: "I understand what agents are and why they're different"

**Audience: everyone, including the CEO and board. Goal: shared vocabulary and calibrated expectations — the #1 failure mode of enterprise AI programs is leadership expecting magic and engineers expecting a demo to be production.**

### Concepts

- What an LLM actually does (next-token prediction, context windows, why it hallucinates) — and what that implies: *probabilistic component, deterministic harness*.
- Prompting fundamentals: system prompts, few-shot examples, structured output.
- What makes an "agent" vs. a chatbot: **tools + loop + goal** — the model can *act*, observe results, and act again.
- Why agents change the risk picture: a chatbot that hallucinates embarrasses you; an agent that hallucinates *does things*.
- The autonomy ladder (L0 shadow → L3 autonomous) and "agents as digital employees" (Playbook §1, §4.2).

### Resources

- Anthropic: "Building effective agents" (engineering blog) — the single best short read; defines workflows vs. agents.
- Anthropic docs: "Intro to Claude" + tool-use overview (read, don't code yet).
- DeepLearning.AI short course: *ChatGPT Prompt Engineering for Developers* or Anthropic's prompt-engineering tutorial — either, 2–3 hours.
- Playbook in this repo: §1 (operating model) and §10 (roadmap).
- **Exec cut** (leadership version, ~half a day): Anthropic "Building effective agents" + Playbook §1, §5, §10 + a live demo of `npm run simulate` narrated by an engineer.

### Lab (2–4 hours)

1. Clone this repo, `npm install && npm test && npm run simulate`. Watch a request flow router → agent → tool → audit log.
2. In a playground (claude.ai or console.anthropic.com), build a prompt that extracts structured JSON from a sample loan-request email. Break it: find an input where it hallucinates a field. Write two sentences on why that matters for a bank.
3. Read `policies/it-operations.yaml` end-to-end. Answer: what can this agent never do, and where is that enforced?

### Gate

Explain, to a non-engineer, in under five minutes: what an agent is, what the autonomy ladder is, and why a human owner is named in every policy file.

---

## Level 1 — Builder: "I can build a working single agent with tools"

**Audience: developers. Goal: fluency with LLM APIs, tool use, structured output, and RAG — the raw materials of every agent.**

### Concepts

- LLM API mechanics: messages, roles, system prompts, temperature, max tokens, streaming.
- **Tool use / function calling**: defining tool schemas, the request→tool_call→result→response loop. This is the core skill of the level.
- Structured output with schema validation (Zod/JSON Schema) — reject-and-retry on parse failure.
- Retrieval (RAG) basics: chunking, embeddings, vector search, grounding answers with citations.
- Context-window management: what to keep, summarize, or drop.
- Error handling for non-determinism: retries, timeouts, fallbacks, idempotency of tools.

### Resources

- Anthropic docs: Messages API, Tool use guide, and the tool-use cookbook examples — do them, don't skim.
- Anthropic courses (anthropic.skilljar.com / GitHub `anthropics/courses`): API fundamentals + tool use modules.
- DeepLearning.AI: *Building Systems with the ChatGPT API* or equivalent — concepts transfer across providers.
- This repo: `src/core/llm-router.ts` (provider abstraction), `src/core/structured-output.ts` (schema-enforced output), `src/tools/` (tool shapes).

### Lab (build on a personal branch)

1. **Hello, tool:** standalone script — Claude with two tools (`get_exchange_rate`, `get_account_type`), answer "what's 5,000 QAR in USD for an SME account?". Handle a tool error gracefully.
2. **Structured output:** extend `src/core/structured-output.ts` usage — take a free-text incident report, return a typed `{severity, system, summary, suggested_playbook}` object; make the schema reject bad enum values and prove the retry path works.
3. **Add a real tool to the framework:** write `src/tools/data/query-hr-directory.ts` (mock), register it in the tool manifest with correct `operationType` and classification ceiling, add it to the PMO agent's allowlist, and prove via a test that the IT agent *cannot* call it.
4. **Mini-RAG:** index the `docs/` folder (any embedding lib), answer questions about the Playbook with citations to section numbers.

### Gate

Exercise 3 merged to your branch with a passing test demonstrating both the happy path and the allowlist denial. Code-reviewed by an L2+ engineer.

---

## Level 2 — Agent Engineer: "I can design and build multi-agent systems"

**Audience: developers and architects. Goal: from calling a model to engineering a system — orchestration, state, memory, inter-agent communication, and the architecture judgment of when NOT to use an agent.**

### Concepts

- **Workflows vs. agents** (Anthropic's framing): prompt-chaining, routing, parallelization, orchestrator-workers, evaluator-optimizer — and the discipline to pick the simplest pattern that works. Most "agent" problems are workflow problems.
- Graph-based orchestration: explicit nodes/edges, checkpointing, resumability (`src/core/graph-engine.ts`).
- State and memory: session state vs. long-term memory, what to persist, TTLs (`src/core/memory.ts`, `src/core/state-store.ts`).
- Inter-agent communication: message envelopes, correlation IDs, why typed payloads beat free-text chatter (`src/core/message-envelope.ts`, Playbook §4.1).
- **MCP (Model Context Protocol)**: servers, tools, resources — the emerging standard for agent↔system connectivity; A2A-style protocols for agent↔agent.
- Human-in-the-loop as an architectural element: approval queues, interrupts, resuming after approval (`src/governance/escalation.ts`).
- Model routing: fast/cheap models for classification, frontier models for reasoning (`src/core/llm-router.ts`); cost architecture.
- Anti-patterns: agent sprawl, unbounded loops, free-text handoffs, "one god agent," LLM-enforced (rather than code-enforced) permissions.

### Resources

- Anthropic: "Building effective agents" (re-read — it lands differently now) + multi-agent research blog posts.
- Claude Agent SDK docs, or LangGraph docs+tutorials — learn ONE orchestration framework deeply; the concepts (graphs, state, interrupts, checkpoints) transfer.
- MCP specification + build-an-MCP-server quickstart (modelcontextprotocol.io).
- This repo: read `src/core/graph-engine.ts`, `src/core/message-bus.ts`, `src/agents/router/` end-to-end — be able to trace a message from API to audit log without running the code.

### Lab

1. **Trace drill:** document (one page, sequence diagram) the full path of a chat request through the framework: every module touched, every governance check, every audit event.
2. **Build a new specialist agent:** `procurement-agent` — policy YAML (scope, allowlist, autonomy overrides, escalation rules), system prompt, registration with the router, intent-classifier update. It must: answer vendor-status queries (READ, L1) and draft purchase-order amendments (MUTATE → must escalate at L2). Integration test proves the escalation fires.
3. **Multi-agent workflow:** a graph where PMO agent requests infrastructure cost data via the message bus from the IT ops agent, combines it with project data, and produces a typed status report. Correlation ID must tie all hops together in the audit log.
4. **MCP exercise:** wrap one existing mock tool as an MCP server; call it from a Claude Desktop/CLI client to see the protocol from both sides.

### Gate

Exercise 2 + 3 pass review by the chief architect: correct pattern choice (justify why agent vs. workflow), correct governance wiring (escalation fires, audit complete), no free-text inter-agent payloads.

---

## Level 3 — Production Engineer: "I can deploy, evaluate, and observe agents like any tier-1 system"

**Audience: senior devs, DevOps/SRE, QA. Goal: the discipline gap between demo and production — evals, CI/CD, deployment, observability, cost, incident response.**

### Concepts

**Evaluate (the heart of this level — Playbook §6):**
- Golden datasets; deterministic assertions (did it call the right tool? escalate when required? refuse out-of-scope?); LLM-as-judge and its calibration problem; human eval sampling; adversarial suites.
- Evals as CI gates: a prompt edit is a code change; regression on every model/prompt/policy change.
- Offline evals vs. online monitoring; drift detection when providers update models.

**Deploy:**
- Containerization (Dockerfile + docker-compose in this repo), environment promotion (dev → staging/shadow → prod).
- Progressive delivery for agents: shadow mode (L0) as the canary, traffic sampling, instant rollback of prompts/policies/model pins *without* redeploying code.
- Secrets and config: vault-backed keys, pinned model IDs per environment, no "latest."
- Scaling and resilience: rate limits (yours and the provider's), queue backpressure, timeout budgets per agent hop, graceful degradation ("agent unavailable → route to human" is a feature).

**Observe (Playbook §8):**
- OTel traces with span-per-tool-call (`src/core/observability.ts`); LLM-specific telemetry (tokens, cost, prompt/completion capture with masking).
- Dashboards per agent: volume, latency, error rate, escalation rate, override rate, cost/task, guardrail-block rate.
- Alerting on *behavioral* anomalies, not just errors. Audit trail vs. telemetry: two systems, two purposes.
- Incident response for agents: the 3-level kill switch (Playbook §9.2), runbooks, the reconstruction drill.

### Resources

- Anthropic docs: evaluations guidance + prompt-engineering-for-reliability sections.
- OpenTelemetry GenAI semantic conventions (otel docs) — the emerging standard for LLM spans.
- An eval framework hands-on: promptfoo (fastest to adopt) or Braintrust/LangSmith equivalent — learn one.
- Your own stack: this repo's `tests/` + `scripts/simulate-workflow.ts` + `vitest.config.ts`.
- SRE fundamentals if missing: Google SRE book, chapters on SLOs and incident management (agents are services).

### Lab

1. **Build the eval harness (the flagship exercise — this is a real gap in the framework):** create `evals/` with a 30-case golden dataset for the router (utterance → expected target agent + expected escalation flag). Runner script executes cases, reports pass rate, exits non-zero under threshold. Wire into `npm run eval` and CI.
2. **Adversarial suite:** 15 red-team cases (injection attempts, out-of-scope requests, PII-extraction attempts) that must ALL fail safely. Add to CI.
3. **Observability:** stand up a local Jaeger via docker-compose; export the framework's OTel traces; produce a screenshot of one request's full trace tree. Add a token/cost counter metric per agent.
4. **Chaos drill:** kill the mock tool backend mid-workflow; verify the agent degrades gracefully, the audit log records the failure, and an alertable metric fires. Then execute the kill switch: disable one agent via the admin route and prove the router responds correctly.
5. **Reconstruction drill:** given only logs from a simulate run, reconstruct the complete causal chain of one task in under 30 minutes.

### Gate

Eval harness (labs 1+2) merged and running in CI. Team can execute the kill-switch and reconstruction drills cold.

---

## Level 4 — Regulated-AI Specialist: "I can secure and govern agents to bank standards"

**Audience: security engineers, risk/compliance (survey the engineering, go deep on governance), senior engineers (the reverse). Goal: the controls, threat models, and regulatory artifacts that separate a fintech demo from a QCB-supervised deployment.**

### Concepts

**Secure (Playbook §3):**
- OWASP Top 10 for LLM Applications — deep, not survey: prompt injection (direct + indirect), excessive agency, sensitive-info disclosure, insecure output handling, supply chain (model/dataset provenance).
- Non-human identity: workload identities per agent, confused-deputy prevention (agent identity × user entitlement), short-lived credentials, per-agent access recertification.
- Blast-radius engineering: designing so the worst-case injected instruction is bounded (allowlist × classification ceiling × autonomy ceiling).
- Data protection: DLP-grade PII detection (incl. Arabic-script names, QIDs), masking strategies, data residency routing (Azure Qatar / on-prem for CONFIDENTIAL+), retention.
- Red-teaming agents: injection→exfiltration chains, tool-abuse scenarios, cross-agent attack paths.

**Govern (Playbook §5):**
- Frameworks: NIST AI RMF (+ Generative AI Profile), ISO/IEC 42001 (AI management systems), EU AI Act high-risk obligations as the international benchmark.
- Regional/sector: QCB AI guideline expectations, Qatar PDPPL, NCSA/NIA controls, Sharia governance for product-touching agents; model risk management (SR 11-7 as global reference) applied to LLMs.
- The governance operating structure: AI Governance Committee, agent owner teams, independent validation (builder/validator separation), evidence packs for autonomy promotion.
- Policy-as-code: why the YAML + git history + protected branches IS the regulator-facing change record.
- Audit trail requirements: append-only/WORM, versions-in-force captured per event, case reconstruction.

### Resources

- OWASP Top 10 for LLM Applications + OWASP LLM security verification materials (owasp.org).
- NIST AI RMF 1.0 + Generative AI Profile (nist.gov) — read MAP/MEASURE/MANAGE functions with agents in mind.
- EU AI Act summary for high-risk systems (any reputable summary; the Act itself for Annex III).
- Anthropic docs: safety best practices; prompt-injection mitigation guidance.
- Lakera/prompt-injection playgrounds (e.g., Gandalf) for intuition; then your own red-team suite.
- Playbook §3, §5, §7, plus the framework's `src/governance/` and `src/core/guardrails.ts` line-by-line.

### Lab

1. **Threat-model an agent:** full STRIDE-style workup of the `credit-assessment` policy: assets, entry points, worst-case-if-compromised (bounded-blast-radius analysis), mitigations mapped to code. Present to the group.
2. **Red-team exercise (paired: security + engineer):** attacker crafts 10 injection/exfiltration attempts against a running instance; defender hardens guardrails + policy until all are blocked or bounded. Both write up findings; surviving attack classes become backlog items.
3. **Strengthen a guardrail:** replace or augment the regex PII rules in `src/core/guardrails.ts` with a proper detector for one PII class (e.g., QID numbers + IBAN), with tests including Arabic-text cases.
4. **Governance artifact drill (compliance-track flagship):** write the complete approval evidence pack for promoting the IT ops agent's "ticket triage" category from L2 to L3: scope statement, eval evidence requirements, override-rate thresholds, rollback plan, committee sign-off template. This becomes the bank's actual template.
5. **Regulatory mapping:** take Playbook §5.1's table and, for one regime (QCB or PDPPL), expand each row into: specific obligation → control in framework → evidence artifact → gap. Gaps become backlog items.

### Gate

Engineering track: labs 1–3 delivered and reviewed. Governance track: labs 4–5 adopted as official templates by the (proto-)AI Governance Committee.

---

## Level 5 — Hero / Program Lead: "I can run QDB's agent program end-to-end"

**Audience: tech leads, chief architect, the person who owns this program. Goal: synthesis — architecture authority, governance fluency, and the judgment to sequence the rollout.**

### Concepts

- Portfolio thinking: which processes to agentify first (high-volume + low-risk + measurable baseline), build-vs-buy per layer (own the governance layer always — Playbook §2.3), platform vs. per-use-case economics.
- Organizational design: agent owner teams, the "agent manager" role, capability building (running THIS learning path), managing the human side (approval fatigue, job-evolution concerns, union-of-skills hiring).
- Autonomy promotion as a governed product process: evidence packs, independent validation, committee cadence.
- Vendor and model strategy: multi-provider posture, exit strategy per QCB expectations, cost trajectory management.
- Staying current without whiplash: what's durable (governance, evals, least privilege) vs. what churns (frameworks, model versions).

### Resources

- Everything above, plus: Anthropic's enterprise/agent case studies; MCP + A2A ecosystem tracking; QCB/NCSA circulars as issued.
- Peer learning: present the program to one external audience (regional banking tech forum, QCB supervisory dialogue) — teaching it is the test.

### Capstone (the hero gate)

Take **one real QDB process** end-to-end through the entire lifecycle:

1. Business case with measured baseline (cycle time, cost, error rate).
2. Architecture decision record: pattern choice, agent(s) design, policy files.
3. Build with a full eval suite (golden + adversarial) in CI.
4. Threat model + red-team report with sign-off.
5. Governance pack: committee approval, owner team named, autonomy plan.
6. Deploy to shadow (L0) with dashboards; run 4+ weeks; present evidence.
7. Promotion decision (to L1/L2) with the evidence pack — or a documented no-go, which is an equally valid capstone outcome.

**You are a "hero" when you have shipped one agent through all seven steps and taught at least one cohort behind you.** The program scales through people who've done it, not through documents — including this one.

---

## Appendix A — 16-Week Cohort Schedule (first cohort, aggressive)

| Weeks | Content | Cohort |
|---|---|---|
| 1–2 | L0 all-hands + exec briefing | Everyone |
| 3–6 | L1 | Developers, QA |
| 5–8 | L2 (architects join) | Devs, architects |
| 9–12 | L3 (DevOps joins) — eval harness built here becomes real CI | Senior devs, SRE, QA |
| 9–14 | L4 parallel track | Security, risk, compliance + 2 senior engineers |
| 13–16 | L5 kickoff: capstone process selected, baseline measured | Leads |

## Appendix B — Skills Matrix (track per person)

Rate 0–3 (none / aware / practiced / can teach) per discipline: prompting & APIs · tool use & structured output · orchestration & multi-agent · MCP/integration · evals · deployment & SRE · observability · security & red-teaming · governance & regulatory · program leadership. Review quarterly; the goal is ≥2 people at "can teach" per column within a year — bus-factor insurance for the program.

## Appendix C — Resource Shortlist (if you only do five things per level)

- **L0:** Anthropic "Building effective agents" · run `npm run simulate` · Playbook §1+§10
- **L1:** Anthropic tool-use guide + cookbook · build exercise 3 (new tool + allowlist test)
- **L2:** one orchestration framework deeply · MCP quickstart · build the procurement agent
- **L3:** promptfoo (or equiv.) hands-on · OTel GenAI conventions · build the eval harness
- **L4:** OWASP LLM Top 10 · NIST AI RMF GenAI Profile · red-team exercise
- **L5:** the capstone. There is no shortcut.

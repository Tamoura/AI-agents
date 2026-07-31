# AI Governance Committee — Charter

> Template (LEARNING-PATH M4.4; PRODUCTION-PLAYBOOK §5.2). Adopt and adapt to
> QDB's committee structure. This charter is itself a governance artifact — the
> board approves it, and changes follow the same review path as `policies/`.

## Purpose
Provide board-delegated oversight of QDB's agentic-AI program: approve each agent
and each autonomy promotion, own the kill-switch decision, and hold owner teams
accountable for the agents they run.

## Membership
- **Chair:** _CIO or delegate_
- CRO / Head of Risk (or delegate)
- Head of Compliance
- Head of Information Security
- Sharia governance representative (for product-touching agents)
- Rotating agent owner-team representative(s)
- **Independent validation** function attends but does not vote on items it validated.

Quorum: _e.g._ chair + risk + compliance + security. Kill-switch decisions may be
taken by any two of {chair, CRO, CISO} under the emergency path below.

## Decision rights
The committee approves, with a recorded vote:
1. Deployment of any new agent (against its policy file + evidence).
2. Any autonomy-level promotion (against an evidence pack — see template).
3. Material policy changes: tool-list expansion, data-classification ceiling
   increase, escalation-rule changes.
4. Model-pin upgrades for any agent holding L2+ authority.
5. Program-level risk acceptance and the annual framework review.

Owner teams decide, within approved policy: day-to-day operation, first-line
approvals, non-material policy maintenance.

## The kill switch (committee-owned)
1. **Per-agent disable** — owner team may invoke; committee notified.
2. **Autonomy downgrade** — owner team or committee; committee ratifies.
3. **Global stop (all agents → L0)** — emergency path: any two of {chair, CRO,
   CISO}; full committee convened within 24 hours to review.

## Cadence
- Monthly standing meeting: KPI review per agent, pending approvals, incidents.
- Emergency path as above for kill-switch decisions.
- Annual: framework review, red-team review, provider exit-drill review.

## Records
Minutes, votes, and evidence packs are retained per bank record-keeping. The git
history of `policies/` is the change record; committee minutes reference the
commit(s) approved.

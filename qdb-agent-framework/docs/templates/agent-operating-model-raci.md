# Agent Operating Model — RACI

> Template (LEARNING-PATH M5.2; PRODUCTION-PLAYBOOK §1, §5.2). Complements
> `ai-governance-committee-charter.md`, which covers only the committee. One RACI per
> program, re-signed whenever a role, an owner team or a lifecycle step changes.

## 1. Header
- **Program owner:**
- **Version / date:**
- **Signed off by:** _committee chair + at least two owner teams_

## 2. Roles and named people
A role with no named person is a finding. Seed this from `owner_team` in each
`policies/*.yaml`, the roles in each `escalation.rules[].notify`, and the charter's membership.

| Role | Named person(s) | Backup | Source (policy file / charter) |
|---|---|---|---|
| Agent owner | | | |
| Owner team | | | |
| AI platform team | | | |
| Independent validation | | | |
| Security | | | |
| Compliance | | | |
| Sharia governance | | | |
| Governance committee | | | |

## 3. RACI matrix
R = responsible, A = accountable, C = consulted, I = informed.
**Rules:** exactly one **A** per row; no row where the builder (R) is also the validator.

| Lifecycle step | Agent owner | Owner team | AI platform | Indep. validation | Security | Compliance | Sharia | Committee |
|---|---|---|---|---|---|---|---|---|
| Policy authoring (`policies/*.yaml`) | | | | | | | | |
| Tool-allowlist change | | | | | | | | |
| Golden-set curation | | | | | | | | |
| Eval gate (release) | | | | | | | | |
| Autonomy promotion | | | | | | | | |
| Approval-queue decisions | | | | | | | | |
| Kill switch — per-agent disable | | | | | | | | |
| Kill switch — autonomy downgrade | | | | | | | | |
| Kill switch — global stop | | | | | | | | |
| Incident notification | | | | | | | | |
| Quarterly access recertification | | | | | | | | |
| Model-pin upgrade | | | | | | | | |

**Rule check:** _list any row with zero or more than one A, and any row where R and the
validator are the same person or team, with its fix._

## 4. Approver capacity
From `GET /approvals` on simulated runs, projected to target volume.

| Role | Approvals per day (projected) | Minutes per item (target 2) | Minutes per day | Available minutes | Fits? | If not: redesign |
|---|---|---|---|---|---|---|
| | | | | | | |

## 5. Skills gap
Current skills matrix (`docs/assessment.html`, Team view) against the minimum viable team.

| Skill column | People at "can teach" today | Needed (≥2) | Cohort that closes the gap | Date |
|---|---|---|---|---|
| | | | | |

## 6. Change plan

| Milestone | Owner | Date | Done when |
|---|---|---|---|
| | | | |

- **Messages for staff whose work shifts to managing agents:**
- **Cultural-failure metrics and thresholds:**
  - Rubber-stamping: unmodified-approval rate _≥ __%_ with median review time _≤ __ s_.
  - Shadow agents: any agent running without a file in `policies/`.

## 7. Sign-off
- **Governance committee chair (name, date):**
- **Owner team 1 (name, date):**
- **Owner team 2 (name, date):**

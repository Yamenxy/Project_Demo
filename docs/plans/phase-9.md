# Phase 9 plan: hardening and privacy

Goal: the roadmap's hardening phase, plus the privacy and oversight requirements still open.
Everything free and local; paid items stay in [paid-services.md](../paid-services.md). The external
penetration test (REQ-SEC-002) and the backup requirements of the paid setup (REQ-OPS-001) can't be
done here; they stay on the launch checklist.

| # | Task | Requirements | Modules |
|---|---|---|---|
| 9.1 | The owner's audit log: every event of the workspace, newest first, filterable by kind, with support entries | REQ-AUDIT-002 | audit, web |
| 9.2 | Support sessions: a platform owner opens read-only access to one workspace with a reason and a ticket, for at most 60 minutes; the owner teacher and the other platform owners are notified; every request is recorded in the workspace audit log; writes get 403; without a session, 404 | REQ-RBAC-003 | tenancy, platform-admin, web |
| 9.3 | Data subject requests: download my data, correct my name, delete my account (14 days to change one's mind, then anonymization; the owner teachers are notified; audit rows keep no name or phone) | REQ-PRIV-003, REQ-AUDIT-001 | identity, jobs, web |
| 9.4 | Retention: the retention table in the docs, and a nightly job that applies the rules the free setup has data for; each run is audited | REQ-PRIV-002, REQ-DATA-004 | jobs, files, notify |
| 9.5 | Checks: the suspended-workspace matrix over every route; config refuses the example encryption key outside local development; accessibility checks on key pages; a local restore drill | REQ-RBAC-004, REQ-A11Y-001, REQ-OPS-005 | tests, config, docs |

Each task ships with tests, audit events, translations in Arabic and English, and doc updates.

**Risks:** support access becoming a back door (read-only enforced in the guard, time-boxed, every
request audited, visible to the owner); anonymization missing a copy of personal data (a test
searches for the name and phone afterwards); the retention job deleting too much (each rule has a
test with rows on both sides of its cutoff).

# Phase 2 plan: teacher onboarding

Goal (architecture §16.4, review §16): a platform owner sets up a teacher, and the teacher brings
in staff and students. Everything free; paid items stay in [paid-services.md](../paid-services.md).

| # | Task | Requirements | Modules |
|---|---|---|---|
| 2.1 | Platform console: list and create workspaces, suspend and restore (admin), simplified subscriptions: plan, end date, recorded payments, automatic grace and billing suspension, teacher reminders | REQ-SUB-001, REQ-SUB-002, REQ-USER-001, D12a | platform-admin (new), tenancy, jobs, notify, web |
| 2.2 | Staff: invite class teachers and helpers by phone, accept, list, grant and revoke permissions, remove | REQ-USER-005, REQ-RBAC-002, REQ-RBAC-006 | tenancy, web |
| 2.3 | Students: join by link or code with approval (or auto-approve), managed student records and claiming, Students tab (list, search, device reset) | D8, REQ-USER-003, REQ-USER-006 (first part) | tenancy, web |
| 2.4 | Import students from XLSX or CSV as invitations and managed records | REQ-USER-002 | tenancy, web |
| 2.5 | Guardian consent for students under 18 (OTP to the guardian's phone), limited account until confirmed | REQ-PRIV-001, OQ-09 default | identity, web |
| 2.6 | Public teacher page `/t/{slug}` with join action | REQ-CONTENT-003 (price list arrives in Phase 4) | tenancy, web |
| 2.7 | Web shell: workspace switcher, teacher and student home | review MISS-05 | web |

Each task ships with tests (integration against Postgres, cross-tenant suite, browser flow where
there's UI), audit events, translations in Arabic and English, and doc updates.

**Risks:** invitations and imports must never reveal whether a phone number has an account
(SEC-02); staff removal must take effect on the next request (REQ-USER-005); subscription jobs must
be idempotent (review §3.27).

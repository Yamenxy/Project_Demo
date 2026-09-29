# Phase 4 plan: Flow B payment records

Goal: the teacher records what students pay them, in cash or by transfer, with receipts, and sees
who collected what. Payments are **records only**: they never grant or remove access (OD-04,
REQ-PAY-009). Everything free; paid items stay in [paid-services.md](../paid-services.md).

| # | Task | Requirements | Modules |
|---|---|---|---|
| 4.1 | Price list: the owner's items (name, integer piastres, currency, description), archive and restore, shown on the public page | REQ-PAY-006, REQ-CONTENT-003 | payments (new), tenancy, web |
| 4.2 | Recorded payments: immutable ledger with collector, optional price item copied onto the entry, reversal entries, gapless receipt numbers per workspace, receipts for students | REQ-PAY-003, REQ-PAY-004, REQ-PAY-007 | payments, web |
| 4.3 | Payment requests: a student submits method, reference and amount; cancel before review; approve (not one's own) or reject with a reason; resubmission links to the rejected one; duplicate references flagged; exactly one ledger entry per approval under concurrency | REQ-PAY-003, REQ-PAY-008, REQ-PAY-010 | payments, web |
| 4.4 | Cash handovers and reports: staff hand cash to the owner, who confirms; per-collector daily totals; income totals net of reversals (`finance.view`); student payment history (`payments.view`) | REQ-PAY-003, REQ-PAY-007 | payments, web |

Proof images on payment requests (REQ-PAY-010) need file storage, which arrives with content in
Phase 5; until then a request carries method, reference and amount, and the proof is added then.
The "resume access" and "add to group" shortcuts (REQ-PAY-009) need access groups (Phase 5);
this phase shows "resume access" only where pausing already exists.

Each task ships with tests (integration against Postgres, cross-tenant suite, concurrency tests
for approvals and receipt numbers, browser flow where there's UI), audit events, translations in
Arabic and English, and doc updates.

**Risks:** gaps or duplicates in receipt numbers under concurrency (a per-workspace counter row
locked in the same transaction); double approval (row lock plus a unique ledger reference); the
ledger must stay append-only (no UPDATE or DELETE for the runtime role).

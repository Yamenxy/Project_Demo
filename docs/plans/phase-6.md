# Phase 6 plan: gradebook, question bank, exams and homework

Goal: Release 2's teaching loop. Teachers record paper scores, write questions, run timed online
exams that survive bad connections, collect homework, and release results. Everything free; paid
items stay in [paid-services.md](../paid-services.md).

| # | Task | Requirements | Modules |
|---|---|---|---|
| 6.1 | Gradebook: grade items per class (paper or linked to an exam), bulk score grid, release, change history with a reason after release, per-student and per-class averages; entries stay with the original class after a transfer | REQ-GRADE-001 to -003 | grading (new), classes, web |
| 6.2 | Question bank: multiple choice, true/false and short answer, LaTeX maths with RTL Arabic, immutable versions once used, short-answer normalisation (digits, whitespace, optional Arabic letter variants) | REQ-QBANK-001 to -003 | assessment (new), web |
| 6.3 | Exams: fixed question set, shuffling, time limit, window, attempt limit, highest or latest, accommodations; deadline computed at start and enforced on every request plus a sweeper; autosave with idempotency; no correctness data before release; enrolled and not paused to start; results into the gradebook | REQ-EXAM-001, -002, -004, -006 | assessment, grading, jobs, web |
| 6.4 | Answer-key corrections after attempts exist, with a regrade preview (scores and pass/fail changes) before confirming | REQ-EXAM-003 | assessment, web |
| 6.5 | Homework: submissions with files for enrolled, unpaused students; late policy (reject, or accept with a flag); at most one resubmission; grading into the gradebook | REQ-HW-001, REQ-HW-002 | assessment, files, grading, web |

**Status (2026-09-30):** tasks 6.1 to 6.5 are done on branch `phase-6/assessments`. Not done:
the REQ-EXAM-005 load test, which needs real hardware.

Performance targets of REQ-EXAM-005 are measured with a load test once the demo runs on real
hardware; this phase keeps start and autosave to a few indexed queries.

Each task ships with tests (integration against Postgres, cross-tenant suite, time-travel tests
with a fixed clock, browser flow where there's UI), audit events, translations in Arabic and
English, and doc updates.

**Risks:** exam deadlines (late start, accommodations, grace; tested with a fixed clock); lost
answers on flaky networks (idempotent autosave, acknowledged only after commit); leaking answer
keys (API tests assert no correctness fields before release).

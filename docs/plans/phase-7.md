# Phase 7 plan: finishing exams and homework

Goal: close the gaps left in the assessment work and measure exams under load, as the roadmap puts
exam load tests in this phase. Timed exams, homework and the gradebook were built in Phase 6.
Everything free; paid items stay in [paid-services.md](../paid-services.md).

| # | Task | Requirements | Modules |
|---|---|---|---|
| 7.1 | Notifications: one per student when grades are released (gradebook, exam and homework results, through a single release path), and one per student whose released exam score changes after an answer-key correction | REQ-EXAM-003, REQ-GRADE-001 | grading, assessment, web |
| 7.2 | Homework comments: a thread on each submission between the student and the staff who grade them, the only staff–student channel; the owner can review every thread; a comment can be reported to the platform owners' queue | REQ-MSG-001 | assessment, platform, web |
| 7.3 | Exam load profiles (k6): exam start at 200 per minute and autosave, with p95 thresholds and a check that no acknowledged answer is lost; a seed script that prepares an exam with many students | REQ-EXAM-005 | tooling, docs |

Each task ships with tests (integration against Postgres, cross-tenant suite, browser flow where
there's UI), audit events, translations in Arabic and English, and doc updates.

**Risks:** notifying before commit (notifications are written in the same transaction); comment
access leaking across classes (the same student scope as grading); load numbers from a laptop
being mistaken for the staging result the requirement asks for.

# Phase 3 plan: classes, schedules and attendance

Goal: the teacher runs their centre in the platform. Classes with a responsible teacher, students
enrolled in them, a weekly schedule that produces sessions, and attendance taken by QR scan or by
hand, including offline. Release 1 content (Flow B payment records in Phase 4, lessons and video in
Phase 5) builds on these classes. Everything free; paid items stay in
[paid-services.md](../paid-services.md).

| # | Task | Requirements | Modules |
|---|---|---|---|
| 3.1 | Classes: create, rename, archive and restore; responsible teacher (owner or an assigned class teacher); enrol, remove and transfer students with history kept | REQ-CLASS-001, REQ-RBAC-006, REQ-GRADE-003 (history) | classes (new), tenancy, web |
| 3.2 | Class scope: class teachers act only on their classes; helper grants can be limited to classes; the student list and actions respect scope | REQ-RBAC-001, REQ-RBAC-002 | tenancy, classes |
| 3.3 | Schedules: weekly series in Cairo wall-clock time, generated sessions as UTC instants, holidays and skip dates, overlap warning for the same teacher, one-off and cancelled sessions | REQ-SCHED-001, REQ-SCHED-002, REQ-ATT-002 | classes, web |
| 3.4 | Attendance: mark present, late, absent or excused per session; 48-hour edit window (later edits need `attendance.edit_late`); idempotent upserts keyed by session and student; cancelled sessions excluded from percentages | REQ-ATT-001, REQ-ATT-002 | attendance (new), web |
| 3.5 | QR attendance: the student's code as a QR, a scanner page that caches the roster, works offline (green, amber, red) and syncs later without duplicates | REQ-ATT-001 | web, attendance |

The course link in REQ-CLASS-001 ("not in two active classes of the same course") needs courses,
which arrive with content in Phase 5; until then the rule is not enforced and the class has no
course.

**Status (2026-09-29):** tasks 3.1 to 3.5 are done on branch `phase-3/classes`. Not done: the
course rule of REQ-CLASS-001 (waits for courses, Phase 5); opening the scanner offline from a
closed tab (PWA service worker, Phase 8); camera scanning on iOS Safari (typed codes work).

Each task ships with tests (integration against Postgres, cross-tenant suite, browser flow where
there's UI), audit events, translations in Arabic and English, and doc updates.

**Risks:** time zones and DST in generated sessions (tested with fixed dates across Egypt's DST
changes); duplicate scans from several offline devices (the upsert key makes them harmless);
scope leaks between classes (cross-class tests next to the cross-tenant suite).

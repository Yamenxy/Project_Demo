# Architecture

**Status:** Baseline for Phase 1. Last updated 2026-09-28.
It implements [requirements.md](requirements.md). Decisions behind it are in [decisions.md](decisions.md).
Update this file whenever the modules, data model, APIs or infrastructure change (CLAUDE.md).

---

## 1. Shape

The system is a **modular monolith**: one TypeScript codebase deployed as three processes.

| Process | Role |
|---|---|
| `web` | Next.js: UI, public pages, PWA |
| `api` | NestJS: REST API with OpenAPI |
| `worker` | pg-boss job worker (`src/worker.ts`). On the free setup the API process runs the workers itself (`WORKER_MODE=inline`). |

Rules that hold everywhere:
- **Controllers contain no logic.** They parse input, call a policy, then call a service.
- **The frontend contains no business rules.**
- **Authorization happens on the server**, on every request, and is denied by default (REQ-RBAC-005).
- **Invariants are kept inside the transaction.** Side effects (notifications, email, push, analytics) are jobs enqueued in the same transaction, which serves as the transactional outbox.
- **Every external provider sits behind an adapter** selected by configuration (REQ-OPS-006).

## 2. Modules

A module owns its tables and exposes a public service API. Other modules may only call that API; they never read its tables directly. This is enforced by lint (dependency-cruiser or eslint-plugin-boundaries).

| Module | Owns |
|---|---|
| `identity` | Users, credentials, sessions, devices, OTP, TOTP, guardian contacts, consent records |
| `tenancy` | Workspaces, memberships (roles), invitations, class-teacher assignments, helper permission grants, support sessions, the policy engine |
| `audit` | Audit log (append-only, partitioned by month) |
| `platform-billing` | Flow A: platform plans, subscription periods, platform payments, platform receipts |
| `payments` | Flow B, **records only**: price list, payment requests, payment ledger, receipts, collectors, cash handovers |
| `access` | Access groups, group lessons, group members, individual lesson rules (grant or block), pause state, **`AccessPolicy`** |
| `catalog` | Courses, lessons, attachments, publish state, soft delete |
| `media` | File objects, the quarantine pipeline, video assets, the `VideoProvider` adapter, playback tokens and keys, watch progress and view limits |
| `scheduling` | Locations, classes, enrolments, session series and occurrences, skip dates |
| `attendance` | Attendance records, scan intake |
| `assessment` | Questions and versions, assessments, attempts, submissions |
| `gradebook` | Grade items (online and paper), entries, change history |
| `notify` | Outbox dispatcher, notifications, push, email, preferences |
| `reporting` | Read-only queries, the Students tab read model, CSV exports |
| `platform-admin` | Owner console, teacher onboarding, tickets |

`access` depends on `tenancy`, `catalog` and `scheduling` (for the "add all students from class X" shortcut). `payments` does **not** depend on `access`. The "resume / add to group" shortcuts after a payment are UI actions that call `access` endpoints (REQ-PAY-009).

## 3. Request flow

1. **Authenticate** with an opaque session cookie, looked up in the database (REQ-AUTH-004).
2. **Resolve the workspace from the URL.** API paths look like `/api/v1/w/{workspaceId}/…`; web paths look like `/w/{slug}/…`. The "current workspace" is never kept in the session or a cookie.
3. **Load the membership** (user, workspace): role, pause flag, permission grants with their class scopes, class-teacher assignments, and the workspace's suspension state. This is one indexed query, cached only within the request (or across requests for a few seconds, with a version number that permission changes increment).
4. **Run the endpoint's declared policy function**, which checks the key, the class scope, object ownership and the suspension state. Any failure returns 404 for resources outside the actor's reach and 403 for insufficient permission on resources inside it.
5. **Open a transaction**, `SET LOCAL app.workspace_id = …`, and call the service with the tenant-scoped database handle.
6. **Write the audit record** and **enqueue any jobs in the same transaction** (`JobsRuntime.enqueue(tx, …)`), then commit. A job exists only if the change committed.
7. Workers run the jobs: notifications, email, push.

Mutating endpoints accept an `Idempotency-Key` header (REQ-DATA-003).

## 4. Tenancy and security design

- **Shared database and shared schema.** `workspace_id NOT NULL` is on every tenant table, and every index on those tables starts with it.
- **Composite foreign keys**: (workspace ID, ID). A cross-workspace reference is rejected by the database.
- **Row-level security as a backstop.** Migration `0000_foundation` defines `app.current_workspace_id()` (reads `app.workspace_id`, NULL when unset) and `app.enable_tenant_rls(table)`, which every tenant-table migration calls. The setting is written with `set_config('app.workspace_id', id, true)` (SET LOCAL semantics) inside the transaction, so it's safe behind transaction-mode connection pooling. Tenant tables are invisible when no workspace is set, so a missing scope fails closed.
- **Database roles.** Group roles are NOLOGIN; each environment creates its own login users and grants each one exactly one group:
  - the **migrator** (schema owner) runs migrations only (`DATABASE_MIGRATOR_URL`, scripts only, never the API);
  - `app_runtime` is the API's role (`DATABASE_URL`), subject to the tenant policies. Append-only tables (audit log, payment ledgers) revoke UPDATE and DELETE from it;
  - `app_platform` sees all workspaces (`DATABASE_PLATFORM_URL`). It is used only through `PlatformDb.run(reason, fn)`, which logs every use; dependency-cruiser allows importing it only in `database/`, `modules/tenancy` and `modules/platform-admin`.
  - At startup the API refuses to serve if either connection user is a superuser, has BYPASSRLS, is outside its group, or is in both groups.
- **Code:** `apps/api/src/database/`. `TenantDb.inWorkspace(id, fn)` gives a scoped transaction; `TenantDb.transaction(fn)` is unscoped and for global tables only. The mechanism is covered by `apps/api/test/database/tenant-isolation.int.spec.ts`.
- **Migrations** are hand-written SQL in `apps/api/drizzle`, created with `pnpm --filter @lms/api db:new-migration <name>` (drizzle-kit `--custom`). drizzle-kit's schema diffing isn't used, because it can't express partitioned tables, row-level security, role grants or column privileges. The Drizzle tables in each module's `schema.ts` mirror the SQL for typed queries, and `test/database/schema-drift.int.spec.ts` fails if they disagree.
- **Audit log** (`modules/audit`, migration `0001`): partitioned by month, with a default partition as a safety net. `app.ensure_audit_partitions(n)` (SECURITY DEFINER, platform role only) creates months ahead. The runtime role may insert events for its current workspace or platform-level events (`workspace_id` NULL) and read only its workspace's events. No role may UPDATE or DELETE, except that the platform role can clear `personal_context` for anonymization. Direct access to partitions is revoked. `AuditService.record(tx, event)` writes inside the caller's transaction.
- **Jobs** (`src/jobs`, migration `0002`): pg-boss in schema `pgboss`, owned by the migrator. `runMigrations` installs and upgrades pg-boss and creates the queues listed in `src/jobs/queues.ts`; runtime instances never create or migrate the schema, and index rebuilds are off. The runtime role has data access to `pgboss` only. Job rows aren't tenant-isolated, so **payloads carry IDs only** and handlers scope their work with `TenantDb.inWorkspace(payload.workspaceId, …)`. Each queue sets its retries and backoff; exhausted jobs are copied to `system.failed_jobs` (kept 30 days). Handlers are registered in `onModuleInit` and must be safe to run twice. Platform maintenance jobs live in `src/jobs/maintenance.ts` (lint allows `src/jobs` to use the platform handle).
- **Tenancy tables** (`modules/tenancy`, migration `0005`): `platform_owners` and `workspaces` are global and written only by the platform role (`WorkspacesService` creates a workspace, its owner membership and the audit event in one transaction). `memberships` and `workspace_invitations` are tenant tables. Database constraints enforce: one role per user per workspace; one owner per workspace; managed records are students with a provisional name and the student's own phone; only students can be paused, and a pause records who did it; internal codes are unique per workspace. `TenantDb.forUser(userId, …)` sets `app.user_id`, which lets a user **read** their own memberships across workspaces (the workspace switcher) and nothing else. Queries in that scope must select only the columns the user may see (for example, never `notes`). Class-teacher assignment is the class's `responsible_membership_id`, added with classes in Phase 3.
- **Access control** (`common/policy`, `modules/tenancy/access.guard.ts`, migration `0008`): every route declares one policy with a decorator: `@Public()`, `@Authenticated()`, `@PlatformOwnerOnly()`, `@WorkspaceRoles([...])` or `@WorkspacePermission(key)`. A single global `AccessGuard` enforces them, and refuses any route without one (`no_policy`); `policy-coverage.spec.ts` fails the build for such a route. Workspace routes live under `/api/v1/w/:workspaceId/…`. The guard resolves the membership and its permissions fresh on each request (so grants and revocations apply immediately), and returns 404 to non-members and 403 to members without the role or permission. It also requires an active account, an active membership, and 2FA for owners, class teachers and platform owners. While the workspace is suspended, a route answers only for the roles listed in `allowWhenSuspended`. Permission keys and the class-teacher bundle are in `common/policy/permissions.ts`. Owner-only actions aren't keys, so nothing can grant them. **Class scopes** (migration `0016`, REQ-RBAC-001/002): `permission_grant_classes` limits a helper's grant to listed classes (no rows: the whole workspace; `students.import`, `access.groups` and `finance.view` are workspace-only). A class teacher's keys cover the classes they're responsible for. `PermissionSet` carries each key's scope (`hasEverywhere`, `scopeOf`, `coversClass`); `@WorkspacePermission` checks that the key is held somewhere, and services check the class. Scoped staff see only classes they cover and students enrolled in them, add students to a class through `GET …/classes/:id/candidates` (names and codes, no phones), and can't approve join requests, create records or see the home counts, which need a workspace-wide grant. The staff page sets a helper's class limit, applied to each of their grants.
- **Notifications** (`modules/notify`, migration `0010`): `NotificationsService.notify(tx, …)` writes the in-app row in the caller's transaction and, for types with an email template, enqueues a `notify.email` job in the same transaction. Rows are partitioned by month (`app.ensure_monthly_partitions`, which also now maintains the audit log). Only the recipient can read them or mark them read (`TenantDb.forUser`), and the runtime role can update nothing but `read_at`. Email goes only to verified addresses (`ContactDirectory`, implemented by identity), in Arabic then English until a language preference exists, through `EmailSender`: SMTP (Mailpit locally) or disabled. Wired events: two-step verification turned on, and password reset. The endpoints are `GET /v1/notifications` (keyset `before`), `POST /v1/notifications/:id/read` and `POST /v1/notifications/read-all`. The web app has a notifications page (`/notifications`) with unread count and mark-all-read. Web push: see **Installable app and web push**.
- **Platform console and Flow A** (`modules/platform-admin`, migration `0011`, REQ-SUB-001): platform owners create a workspace for a teacher who has already registered and verified their phone. The workspace gets a 14-day trial subscription in the same transaction. Owners record payments (`platform_payments`, an immutable ledger); each extends the paid period from the later of its current end and now, in calendar months, and lifts a billing suspension. An hourly idempotent job suspends a workspace for billing once the 7-day grace period is over, and sends the teacher reminders 3 days before the end, on the day and 3 days after (one of each per period, `subscription_reminders`). An admin suspension survives payments until an owner restores it. Teachers see their plan and payments at `GET /v1/w/:workspaceId/billing`, even while suspended. The first platform owner of an environment is added with `pnpm --filter @lms/api platform:add-owner <phone>`. Screens: `/platform` and `/platform/:workspaceId`.
- **Staff** (`tenancy/invitations.service.ts`, `staff.service.ts`, REQ-USER-005): the owner invites a class teacher or helper by phone. The API returns a one-time link (`/join/staff?w=…&t=…`, only a hash is stored, valid 7 days), which the owner copies or shares on WhatsApp. The invitee accepts while signed in with that same verified number, so a forwarded link is useless to anyone else. A new invitation for the same number replaces older ones. Removing staff sets the membership to `removed` and deletes its grants; access ends on the next request. Accepting again reactivates the same membership (BIZ-11). A student can't become staff in the same workspace. Owner-only routes: `/v1/w/:id/staff…`; invitee routes: `/v1/invitations/preview|accept`.
- **Students joining** (`tenancy/students.service.ts`, migration `0012`, D8, REQ-USER-003, REQ-USER-006): each workspace has `workspace_settings` with a 6-character join code (no 0/O/1/I) and an auto-approve switch. A signed-in, verified user joins with `POST /v1/join` (`code` or `slug`); the lookup is the `SECURITY DEFINER` function `app.workspace_join_target`, which returns only the id, name and flags of the one matching workspace. The membership is `pending` (the owner is notified) or `active` when auto-approve is on. Suspended workspaces refuse joins. Staff with `enrollment.manage` list and search students (name, platform code, internal code, phone), approve or reject requests, and add a **managed** student (name, phone, internal code) with a claim link (`/join/student?w=…&t=…`, 30 days, hash stored). The student claims it through the same accept flow as staff invitations, signed in with that phone, and the record keeps its history. Removing a student is owner-only and needs a reason (audited). The owner rotates the code or changes auto-approve at `/v1/w/:id/joining`. Screens: `/w/:id/students` and `/join?code=…`.
- **Student import** (`tenancy/student-import.service.ts`, `tenancy/import/`, REQ-USER-002): `POST /v1/w/:id/students/import` (`students.import`) takes a CSV or XLSX file as base64 JSON (at most 512 KB and 1000 students, so it fits the default body limit). CSV encoding is detected (byte-order mark, then strict UTF-8, else Windows-1256) and the delimiter guessed; XLSX is read with a small built-in zip and XML reader (first sheet, cell text only, unzipped size capped at 20 MB) instead of a spreadsheet dependency. Arabic or English headers pick the columns, otherwise name, phone, code. Without `commit` it returns a per-row report only; with it, the accepted rows become managed records in one transaction (serialized per workspace by locking `workspace_settings`), each audited, plus a `students.imported` summary. The report gives the same status to a number with an account and one without (SEC-02); it flags numbers already in the workspace, repeats, missing or invalid phones and used internal codes. A user whose verified phone matches an active managed record takes it over when they join by code (no approval; audited as `student.claimed`), so the teacher only needs to share the join code after importing.
- **Guardian consent** (`identity/consent.ts`, `consent.service.ts`, migration `0013`, REQ-PRIV-001, AD-09): users have `guardian_phone_e164` (contact only) and `guardian_consent_at`; `guardian_consents` is an append-only record of method (`otp` or `paper`), consent text version, guardian number and, for paper, the workspace and the staff member. The pure `consentState()` gives `not_required`, `granted`, `needed` (limited, inside 14 days) or `overdue`; the session carries it, and the access guard refuses workspace routes to an overdue **student** membership (`guardian_consent_required`). Staff are never blocked. `isLimited()` is the check future upload routes use. Routes: `GET /v1/auth/consent`, `POST /v1/auth/consent/details|send-code|verify` (the code goes to the guardian's phone with the same send limits and lockout as other codes, shared through `OtpLimits`), and `POST /v1/w/:id/students/:membershipId/consent` (paper, `enrollment.manage`). The student list shows each student's consent state (never the date of birth) and filters `?consent=missing`. Screens: `/consent`, a reminder on the account page, and the Students tab filter.
- **Public teacher page** (`tenancy/public-page.service.ts`, migration `0014`, REQ-CONTENT-003): `GET /v1/public/teachers/:slug` needs no sign-in and returns only the workspace name, the owner's short text and subjects, read through the `SECURITY DEFINER` function `app.public_teacher_page` (hidden when the owner turns it off or the workspace is suspended; `Cache-Control: no-cache`, so hiding is immediate). The owner edits it at `/v1/w/:id/public-page` (audited). The page `/t/{slug}` joins with `POST /v1/join {slug}`; signed-out visitors go through sign-in or sign-up and come back (`next` now flows through registration and phone verification). It also lists the active price items.
- **Classes** (`modules/classes`, migration `0015`, REQ-CLASS-001): `classes` has one responsible teacher (the owner or an active class teacher; checked in the service), a name unique among active classes, and archive and restore. `class_enrollments` keeps history: removing or transferring ends the row (`removed` or `transferred`) instead of deleting it, and a partial unique index allows one active enrolment per student per class. The owner creates, renames, reassigns and archives (`/v1/w/:id/classes…`); `enrollment.manage` enrols, removes and transfers. Class teachers see and act on only the classes they're responsible for (other classes answer 404); helpers see the classes their grants cover. The course rule of REQ-CLASS-001 is described with courses below. Screens: `/w/:id/classes` and `/w/:id/classes/:classId`.
- **Schedules** (`classes/schedule.service.ts`, migration `0017`, REQ-SCHED-001/002): `class_series` stores a weekday, local start time, duration and IANA zone (`Africa/Cairo`); `class_sessions` holds each occurrence as UTC instants plus its local date. Sessions are generated in SQL (`(date + time) AT TIME ZONE zone`, so DST is applied per date) up to 56 days ahead, lazily whenever a schedule or agenda is read; a unique (series, day) index makes it idempotent, so no background job is needed. `workspace_skip_dates` are days off: none are generated, and generated future sessions on that day are removed (or cancelled when they already have attendance). Ending a series removes its future sessions the same way. One-off sessions have no series. Creating a series or session returns overlap warnings for the same responsible teacher, without blocking. Cancelling needs a reason and is audited; cancelled sessions are kept. `schedule.manage` covering the class is required; days off need it workspace-wide. `GET /v1/w/:id/sessions?from&to` is the agenda: staff see their classes, students the classes they're enrolled in. Screens: the class page's schedule section and `/w/:id/schedule`.
- **Attendance** (`classes/attendance.service.ts`, migration `0018`, REQ-ATT-001/002): `attendance_records` has one row per (session, student) with status (present, late, absent, excused), method (manual or qr) and the time it was taken on the device. Saving is idempotent: scans insert only when no record exists, manual entries overwrite, so repeated or parallel uploads can't duplicate or undo a correction. Records can be changed until 48 hours after the session ends; later changes need `attendance.edit_late` for the class and a reason, and each is audited with old and new value. Cancelling a session that has records needs `confirm`; the records stay and cancelled sessions are left out of rates (present or late over recorded). The roster (`GET …/sessions/:id/attendance`) returns the class's students with their status and pause state, plus the workspace's other students (names and codes only) so a scanner can tell "not in this class" from "unknown code". Rates: `GET …/classes/:id/attendance` for staff, `GET …/my/attendance` for a student. Screen: `/w/:id/sessions/:sessionId`, opened from the schedule.
- **QR attendance** (`apps/web/lib/scan.ts`, `components/workspace/scanner-view.tsx`, REQ-ATT-001): a student's home shows a QR of `lms:<platform code>`. The scanner page (`/w/:id/sessions/:sessionId/scan`) caches the roster in `localStorage` when opened online, classifies each code on the device (green: in the class; amber: paused or not in this class, with "record anyway"; red: unknown), and keeps a queue in `localStorage` that uploads as `qr` records on reconnect, every 15 seconds, and after each scan, one upload at a time. Camera scanning uses the browser's `BarcodeDetector` (Chrome on Android); where it's missing (Safari on iOS), staff type the code. **Offline:** the service worker (below) lets the page reopen offline after one visit online. **Limits:** a QR library for iOS cameras would be a new dependency and is left for the pilot's findings.
- **Price list** (`modules/payments`, migration `0019`, REQ-PAY-006): `price_items` in integer piastres with a currency, archived instead of deleted (the runtime role has no DELETE). The owner edits it at `/v1/w/:id/price-items`; staff and students can read the active items. The public page reads them through `app.public_price_list(slug)`. The web app formats piastres with `formatMoney` and reads typed amounts (Arabic-Indic digits and the Arabic decimal mark included) with `parseMoney`. Screen: `/w/:id/prices`.
- **Payment ledger** (`payments/ledger.service.ts`, migration `0020`, REQ-PAY-003/004/007): `payment_entries` is append-only (no UPDATE or DELETE for the runtime role, so no row locks either). Each entry is a `payment` or a `reversal` (full amount, `reverses_id` unique, so a payment is reversed at most once), with method, collector (required for cash), the price item's name and price copied, and a receipt number from `receipt_counters`: an upsert that increments the workspace's row inside the same transaction, so concurrent writers queue and committed numbers have no gaps. Recording needs `payments.record` for a student in scope; the ledger needs `payments.view` (scoped); reversing is owner-only with a reason. The student is notified and sees their receipts. Payments never change access (OD-04). Screens: `/w/:id/payments` (record, ledger, reverse), `/w/:id/payments/:id` (printable receipt), `/w/:id/my-payments`.
- **Payment requests** (`payments/requests.service.ts`, migration `0021`, REQ-PAY-008/010): a student submits amount, method (transfer, wallet, other) and reference, can cancel while pending, and can resubmit a rejected request (`resubmits_id`). Approval locks the request row, re-reads the approver's membership, permissions and scope and the workspace state inside the transaction, and appends one ledger entry whose `request_id` is unique, so 20 parallel approvals give one entry and one receipt; an approver can't approve their own submission. Rejection needs a reason and notifies the student. Reused references are flagged on every request that shares them, never blocked. `payments.confirm` (scoped) reviews. Proof images wait for file storage (Phase 5). The cross-tenant suite calls student-only routes as a student of the attacker's workspace.
- **Cash and income** (`payments/cash.service.ts`, migration `0022`, REQ-PAY-003/007): `cash_handovers` records cash a staff member hands to the owner (pending, then confirmed or rejected by the owner; the owner never hands over). What a person holds is their cash payments net of cash reversals minus confirmed handovers. `GET …/reports/cash-day?date` gives per-collector totals for a Cairo calendar day, and `GET …/reports/income?from&to` totals by method net of reversals; both need `finance.view`. `GET …/cash` shows everyone's balance to the owner and finance staff, and only one's own to other collectors. Screen: `/w/:id/cash`.
- **Courses and lessons** (`modules/content`, migration `0023`, REQ-CONTENT-001/002): `courses` and ordered `lessons` (title, text, position, published, soft-deleted). Staff with `content.edit` edit drafts in the courses their scope covers (workspace-wide, or courses linked to their scoped classes); creating a course needs a workspace-wide grant; `content.publish` publishes; deleting and restoring is owner-only and allowed for 30 days (purging older rows is a later maintenance job). A class can follow a course (`classes.course_id`, owner): enrolling a student who is already in another active class of that course is refused (`same_course_enrolled`) unless `override` is sent, which is audited per student; transfers between classes of the same course are allowed. Screens: `/w/:id/courses`, `/w/:id/courses/:courseId`, and the course selector on the class page.
- **Access to lessons** (`content/access-policy.ts`, `access.service.ts`, migration `0024`, OD-02, REQ-CONTENT-001/005–010): `decideAccess()` is the one pure rule (active student, published, workspace not suspended, not paused, no block, and a group or a grant; a table-driven test covers every term). `AccessService.lessonsFor()` reads all the facts for a student in one query per request (nothing cached) and every lesson read goes through it; a refusal answers `no_access` with the reason. `access_groups` hold lessons and students (`access.groups`, workspace-wide; "add all students from class" copies the current enrolments once; archiving ends the group's effect and keeps its history). `lesson_rules` has one row per (student, lesson), grant or block, set in bulk by `access.grants` within scope (students in scope, lessons in courses in scope). `access.pause` pauses and resumes in bulk with a reason (`memberships.paused_at`). "Remove from all groups and grants" is owner-only, needs the student's name typed, and keeps blocks. Each bulk operation is one transaction and one audit event. Staff with `content.edit` preview any lesson in scope, drafts included. After recording a payment for a paused student, staff with `access.pause` get a "resume access" shortcut; payments themselves never change access (REQ-PAY-009). Screens: `/w/:id/lessons` and `/w/:id/lessons/:id` for students, `/w/:id/groups`, and `/w/:id/students/:membershipId/access`.
- **Files** (`modules/files`, migration `0025`, REQ-FILE-001, REQ-PAY-010): uploads send raw bytes (`application/octet-stream`, at most 20 MB; the only non-JSON body the API accepts) to `POST /v1/w/:id/lessons/:lessonId/files` (staff with `content.edit` for the course) or `/payment-requests/:requestId/files` (the student's own pending request). The owner is checked before the body, the bytes are stored under `quarantine/`, and a `files.scan` job accepts them only if the magic bytes match an allowed type (lessons: PDF and images; proofs: images), moving them to `available/`; otherwise the file is rejected and deleted. `GET /v1/w/:id/files/:fileId` checks the owner's rules on every request (AccessPolicy for lesson files, `payments.confirm` in scope or the submitting student for proofs) and serves with `nosniff`, `default-src 'none'; sandbox`, `no-store`, and `attachment` unless it's an image. Storage sits behind `FileStorage`; the free setup uses `LocalDiskStorage` (`STORAGE_DIR`). A student without guardian consent yet (a limited account, REQ-PRIV-001) gets `consent_required` after the owner check and before anything is stored. **Not built:** image re-encoding (needs an image library) and the cookieless file origin (needs a domain); both are in paid-services.md.
- **Video, `self-hls`** (`modules/video`, migration `0026`, REQ-VIDEO-001–005, AD-11): staff with `content.edit` upload a lesson's video (raw bytes, at most 200 MB on the free setup); a `video.transcode` job probes it with ffprobe and runs one ffmpeg pass into 240p and 480p HLS (6-second segments, master playlist) under `STORAGE_DIR/video/<workspace>/<video>/`, keeping the original; a file that isn't a video is marked failed. `POST …/lessons/:id/playback` passes AccessPolicy (staff: preview scope) and, for students, the view limit (`lesson_videos.view_limit_seconds` against `video_watch_time`, reported by the player every 15 seconds; staff with `access.grants` reset it), then returns a playback token: HMAC-signed video id, session id and expiry (10 minutes). `GET …/video/:videoId/:file?t=` checks, in order, that the video is in this workspace (404), the token (403), and the file name against a fixed pattern; playlists re-check AccessPolicy and have every URI rewritten to carry the token. The player (hls.js, lazy-loaded) starts at the lowest rendition, caps quality on Save-Data or cellular, shows data per hour for each quality, renews the token every 8 minutes, and draws a moving watermark with the platform code and first name. **Not built:** the concurrent-stream limit, segment encryption, and the Bunny adapter (paid-services.md).
- **Gradebook** (`modules/grading`, migration `0027`, REQ-GRADE-001–003): `grade_items` belong to a class (paper, or later linked to an exam or homework) with a maximum score; `grade_entries` hold one score per student and item; scores are integer hundredths of a point (null: absent). Every change writes an append-only `grade_changes` row (old, new, who, when, reason); once an item is released a reason is required and the change is audited as `grade.changed_after_release`. `grading.grade` for the class creates items and enters scores in bulk; `grading.release` releases through `GradingService.releaseItem`, the single release path that exam and homework results also use: the first release of an item sends each student who has a score one in-app `grades.released` notification, in the same transaction; releasing again sends nothing. Students see only released items, in every class they have scores in, so a transferred student's old scores stay with the old class and still show on their report. Averages are percentages over graded items (absent isn't counted). Screens: `/w/:id/classes/:classId/grades` (one item at a time, one input per student, one save, made for phones) and `/w/:id/grades` for students.
- **Question bank** (`modules/assessment`, migration `0028`, REQ-QBANK-001–003, AD-12): `questions` belong to a course and point to their current version; `question_versions` are immutable (kind: multiple choice, true/false or short answer; body with `$…$` LaTeX; choices with server ids; answer; feedback; points). `assessment.edit` for the course lists, creates, versions and archives questions. Short answers are compared after `normalizeAnswer` (Arabic-Indic digits, whitespace, case, tatweel; with the teacher's option, Arabic letter variants and diacritics). The web app renders maths with KaTeX inside left-to-right isolates (`MathText`), in questions and lesson text. Screen: `/w/:id/courses/:courseId/questions` with a live preview.
- **Exams** (`assessment/exams.service.ts`, `attempts.service.ts`, `exam-rules.ts`, migration `0029`, REQ-EXAM-001/002/004/006): an exam is a fixed list of question versions for a course, targeted at classes, with a window, time limit, attempt limit, highest-or-latest rule, optional shuffling, pass mark and per-student accommodations; settings and questions lock once any attempt exists. A student starts only if actively enrolled in a target class and not paused (neutral `exam_unavailable`), inside the window, with attempts left; starts are serialised per student and exam (an advisory lock, plus a partial unique index on open attempts), so parallel starts resume the same one. The deadline is computed once at start: `min(start + limit, window end) + accommodation`. Each answer is an upsert keyed by (attempt, question) and applied only if its client `seq` is higher, so retries and out-of-order saves are harmless. Answers are accepted until deadline + 60 s; any request after that closes the attempt (`timeout`) on the spot, and the `exam.sweep` job (every minute, through the narrow `app.overdue_exam_attempts` function) closes the rest. The paper never includes answers or correctness; a student sees their score only after results are released. Releasing (`grading.release` for every target class) writes each student's counted score into an `exam` grade item in their class and releases it. The web client (`lib/exam-client.ts`) queues answers on the device until acknowledged, marks each question saved or not saved, times against the server deadline corrected for the device clock, and submits at zero. Screens: `/w/:id/exams` and `/w/:id/attempts/:id` for students; `/w/:id/courses/:courseId/exams` and `/w/:id/exams/:id` for staff. REQ-EXAM-005's targets are checked by the k6 profile `load/exam.js` (start p95 < 500 ms at 200 starts a minute, autosave p95 < 300 ms, no acknowledged answer lost, each read back after the saves), with a fixture from `pnpm --filter @lms/api load:seed`; see `load/README.md`. The acceptance run needs a staging environment sized like production.
- **Answer-key corrections** (`assessment/regrade.service.ts`, REQ-EXAM-003): once an exam has attempts, the only change is an answer key. `POST …/exams/:id/items/:position/key-preview` computes, without writing, how many attempts, students' counted scores and pass/fail outcomes would change; `…/key` makes a new question version with the same text and choice ids and the corrected answer, points the exam item at it, regrades every submitted attempt, and, if results were released, updates the grade entries with the reason "answer key corrected" (kept in the grade history). Each student whose released counted score changed gets one `exam.regraded` notification; before release nothing is sent, since students can't see scores yet (they hear about them when results are released). Audited as `exam.key_corrected`. The staff exam page shows the preview before the confirm button.
- **Homework** (`assessment/homework.service.ts`, REQ-HW-001, REQ-HW-002): staff create homework for a course with target classes, a due time, a late policy (`reject`, or `accept_flagged`, which stores `late = true`) and an optional single resubmission (`number` 1 or 2, unique per student). A student may submit only while actively enrolled in a target class and not paused; access groups don't matter. Files go through the files module with owner type `homework_submission` (PDF or images, quarantined and scanned); the student can attach them until the submission is graded, and staff with `grading.grade` over the student can read them. Grading stores the score and feedback on the submission; students see neither until results are released. Release (`grading.release` for every target class) writes each student's latest graded submission into a `homework` grade item per class. Audited as `homework.created`, `.published`, `.submitted`, `.graded` and `.results_released`.
- **Homework comments** (`assessment/comments.service.ts`, `platform-admin/reports.service.ts`, migration `0031`, REQ-MSG-001): the only channel between staff and students. Each submission has a thread; the student posts on their own submissions, staff on submissions of students in their `grading.grade` scope (everyone else gets 404). The runtime role can't update or delete `homework_comments`, so the owner's review page (`GET …/homework-comments`, `/w/:id/comments`) shows everything that was said. Each comment notifies the other side (`homework.comment`: the student, or the grader, else the owner). Anyone in a thread can report someone else's comment once (`comment_reports`); the platform owners see open reports on their console (`GET /v1/platform/comment-reports`) and dismiss them or hide the comment (`hidden_at`, set only through the platform handle), after which everyone sees "hidden" instead of the text. Audited as `homework.comment_posted`, `homework.comment_reported` and `platform.comment_report_resolved`. **Not built:** the retention job for comments (REQ-PRIV-002, with the other retention rules).
- **Announcements** (`modules/announcements`, migration `0032`, REQ-NOTIF-001): `announcements.post` holders post to one class they cover, or, with the permission for the whole workspace (the owner), to every student. Posting writes the row and enqueues `announce.fanout` in the same transaction; each job writes the in-app notifications (`NotificationsService.notifyMany`, one insert) for the next 250 active students with an account, in membership-id order, then enqueues the next batch 1.5 seconds later: about 2,000 students in 15 seconds, with no load on the API request. `fanout_cursor` moves in the same transaction as the notifications, so a retried or duplicated batch does nothing. Paused students are included (announcements aren't lesson notifications). Audited as `announcement.posted`. Screens: `/w/:id/announcements` for staff (post form, list with delivery state) and students (their workspace and class announcements).
- **Lesson notifications** (`content/access.service.ts`, REQ-NOTIF-003): `AccessService.decisions()` reads the access facts for many students and lessons in one query and applies the same `decideAccess`. Every change that can open lessons (publishing, a group's lessons or members, adding a class to a group, unarchiving a group, grant/block/clear rules) runs inside `notifyingOpened()`, which compares what each affected student can open before and after, in the same transaction, and sends each student who gained lessons **one** notification: `lesson.published` or `lesson.available` for one lesson (with a link to it), `lessons.available` with the count for several. Only effective access counts, so paused or blocked students, managed records and unpublished lessons never notify. Pausing sends nothing, and resuming doesn't re-announce lessons the student had before.
- **Installable app and web push** (`apps/web/public/sw.js`, `app/manifest.ts`, `lib/push.ts`, `modules/notify/push`, migration `0033`, REQ-NOTIF-001, REQ-ATT-001): a web manifest (Arabic, standalone, brand icons) and a service worker registered in production builds. The worker caches only the app's static files (cache first) and, network first, the attendance scanner pages and the workspace context they load, so a scanner opened once online reopens with no connection (the roster and queue are already in `localStorage`). Nothing else is cached; signing out deletes the cache and the browser's push subscription (on the server too). Push goes through the `PushSender` adapter (`PUSH_PROVIDER=none` by default; `webpush` with a VAPID key pair via the `web-push` library). `push_subscriptions` is a global table like `sessions`: the API reads and writes only the signed-in user's rows (`/v1/push/key`, `/v1/push/subscriptions`, `/v1/push/subscriptions/remove`). Every in-app notification enqueues a `notify.push` job in its own transaction (one job per announcement batch); the job sends a **generic** message ("you have a new notification", plus the link), so no notification content passes through the browser vendors' push services, and deletes subscriptions the browser reports gone (404/410). The browser's permission prompt appears only when the user presses "turn on notifications", which is offered on the notifications page and after submitting homework, never on first load. **Not built:** per-type push preferences.
- **Sessions** are server-side (opaque token in an HttpOnly `lms_session` cookie, SHA-256 stored). **Devices** (`identity/devices`, migration `0006`): a browser is identified by a 400-day HttpOnly `lms_device` cookie. Student accounts may have 2 active devices and register at most 2 new ones per 30 days (a staff or support reset opens a new window). Admission is serialized per user with a row lock, and removing a device ends its sessions. Whether limits apply is decided by `DeviceLimitPolicy`, implemented in tenancy: staff and platform owners are exempt. The per-workspace concurrent-stream counter is not built yet (see Video).
- **Passwords** are hashed with argon2id.
- **2FA (TOTP)** (`identity/two-factor`, migration `0007`): RFC 6238 (SHA-1, 30 s, 6 digits, ±1 step, no replay of a used step), implemented in-house and tested against the RFC vectors. Secrets are sealed with AES-256-GCM (`SECRET_ENCRYPTION_KEY`, one per environment). There are 10 single-use recovery codes, stored as hashes. A session of an account with 2FA starts pending: only `me`, `logout` and `2fa/verify` accept it until the code is checked. **Required** for platform owners, owner teachers and class teachers; the check sits in the permission engine (Phase 1 task 13).
- **Support access**: read-only, time-limited, with a reason, audited, and visible to the teacher (REQ-RBAC-003).
- **User files** are served from a separate cookieless origin. Uploads start in quarantine and have their magic bytes checked. Images are re-encoded.
- **The isolation suite** (REQ-SEC-001, `test/access/cross-tenant.int.spec.ts`) enumerates every workspace route from the application's route table (AD-08). Each route is called by another workspace's owner, pointed both at the victim workspace and at the attacker's own workspace with the victim's resource IDs, and must answer 404. A route parameter without a fixture fails the suite. Out-of-scope (class-level) checks join when classes exist (Phase 3).
- **Idempotency** (`src/idempotency`, migration `0009`): a global interceptor. A signed-in mutating request with an `Idempotency-Key` header runs once; repeats within 24 hours replay the first successful response (header `Idempotent-Replayed: true`). The same key with a different body gives 422, and a repeat that arrives while the first is still running gives 409. Failures aren't stored, so they can be retried. Anonymous requests ignore the header. Expired keys are purged hourly.

### 4.0 Web client foundation

- `apps/web`: Next.js App Router under `app/[locale]/`, with locales `ar` (default, RTL) and `en`. Browser-language detection is off, so the user switches explicitly (D32).
- next-intl provides ICU messages in `messages/{ar,en}.json` (a test checks key parity and every Arabic plural category) and displays times in `Africa/Cairo`.
- `proxy.ts` (Next 16's middleware) adds the locale prefix. `/api/*` is rewritten to the API origin (`API_ORIGIN`), so cookies are first-party.
- Styling is Tailwind 4 using logical utilities only. One self-hosted Arabic font (IBM Plex Sans Arabic, 2 weights, subset).
- `lib/bidi.tsx` provides `<Ltr>`/`<Auto>` for mixed-direction text; `lib/format.ts` formats numbers with Western digits by default and Arabic-Indic as a preference.
- Lint forbids string literals in JSX.
- **Account screens** (`components/auth`): register, confirm phone, sign in, two-step verification, and my account (2FA setup with a QR code and recovery codes, devices, notifications link, sign out, sign out everywhere). Staff can reset a student's devices through `POST /v1/w/:workspaceId/memberships/:membershipId/devices/reset` (`students.sessions_reset`); the button is on the Students tab. They're client components calling `/api/v1` through `lib/api.ts`. Errors are shown by their API code through `errors.<code>` messages.
- Playwright checks direction, locale switching, and that there's no horizontal scroll on a Pixel 7 viewport. It also runs the full account flow in Arabic against the built API (CI job `browser`, with a Postgres service). The OTP comes from the development `file` sender (`OTP_PROVIDER=file`), which production config refuses. A budget test fails if a student page downloads more than 170 KB of compressed JavaScript (currently about 150–157 KB). **Not yet built:** pixel-snapshot baselines, which need to be generated on Linux in CI so they match the runner.

**Workspace screens** (`components/workspace`): `/w/:workspaceId` pages share `WorkspaceShell`, which loads the context once, shows the navigation the role allows (the API still checks every request) and the neutral suspension notice. Pages so far: home, students (owner, `enrollment.manage` or `students.import`), staff (owner), billing (owner). A switcher in the header moves between the user's active workspaces. Staff home shows counts from `GET /v1/w/:id/summary` (join requests, missing consent, active students, records not yet taken over; only for `enrollment.manage`) linking to the filtered Students tab; student home shows the platform code and a consent reminder. The account page lists the user's workspaces. Sign-in returns to a same-site `next` path, including through the 2FA step. The permission registry lives in `packages/shared` for both apps.

### 4.1 AccessPolicy

`AccessPolicy.canAccessLesson(membership, lessonId)` is one SQL existence check:

```
membership.role = 'student' AND membership.status = 'active' AND membership.paused_at IS NULL
AND workspace not suspended
AND lesson.status = 'published' AND lesson.deleted_at IS NULL
AND NOT EXISTS (rule: kind = 'block' for (membership, lesson))
AND ( EXISTS (rule: kind = 'grant' for (membership, lesson))
      OR EXISTS (group_member m JOIN group_lesson g ON m.group_id = g.group_id
                 WHERE m.membership_id = membership AND g.lesson_id = lesson AND group not archived) )
```

- The **batch form** `accessibleLessons(membership)` returns lesson IDs together with the reasons for each: a list of groups, a grant, a block, a pause. The Students tab (REQ-USER-006) and the student's lesson list both use it.
- Staff preview is a separate policy, based on `content.edit` in scope.
- Results are **never** cached across requests (REQ-CONTENT-001).
- Homework and exams are **not** gated by groups. They require an active enrolment in a targeted class and no pause (REQ-HW-002, REQ-EXAM-006).

## 5. Core entities

The fields listed are the essential ones. Every tenant table also has `workspace_id`, `created_at`, `updated_at`, and a `version` column where concurrent edits are possible.

**Identity (global)**
- **User**: platform code (unique), name in Arabic (plus optional Latin), phone (E.164, unique once verified, required for students), email (optional), date of birth, status, password hash, TOTP secret.
- **GuardianContact**: student user, phone (not unique), name, relation, nullable `guardian_user_id` (for parent accounts later).
- **ConsentRecord**: user, document type, version, given by (student or guardian), method (OTP or paper), time, IP.
- **Session**, **DeviceRegistration**, **OtpChallenge**.

**Tenancy**
- **Workspace**: slug, owner user, suspension flag and reason, settings (concurrent-stream limit and so on).
- **Membership**: workspace, user (nullable for managed records), role (`owner`, `class_teacher`, `assistant` or `student`), status, internal code (unique per workspace), notes, provisional name and phone (for managed records), **`paused_at`, `paused_by`, `pause_reason`**.
  - Unique on (workspace, user).
- **PermissionGrant**: membership, permission key, class scope (null means all classes). Used for helpers, and for extra keys given to class teachers.
- **Invitation**: workspace, phone, role, token hash, expiry, status.
- **SupportSession**: platform user, workspace, reason, ticket reference, start, end.

**Structure**
- **Location**, **Course**.
- **Class**: course, location, capacity, status, **`responsible_membership_id`** (the owner or a class teacher). A class teacher's scope is the set of classes where they are the responsible teacher.
- **ClassEnrolment**: class, student membership, valid from and to, status. There's a partial unique index for the active enrolment.
- **SessionSeries**: recurrence rule, local time, timezone.
- **ClassSession**: starts at and ends at (UTC), status, location override.
- **SkipDate**.

**Content and access**
- **Lesson**: course, title, ordering, status (Draft, Scheduled, Published or Unpublished), publish time, `deleted_at`.
- **Attachment**.
- **MediaAsset**: type, provider, provider reference, storage key of the original, processing status, duration.
- **AccessGroup**: name, `archived_at`.
- **AccessGroupLesson**: group and lesson, unique on the pair.
- **AccessGroupMember**: group and student membership, unique on the pair, plus who added it and when.
- **LessonAccessRule**: student membership, lesson, kind (`grant` or `block`), unique on (membership, lesson), plus who set it and when.
- **WatchProgress**: membership, asset, seconds watched, maximum position, accumulated watch time (for view limits).
- **VideoViewLimit**: lesson, limit (N × duration).
- **PlaybackToken**: session, membership, asset, expiry (kept short-lived; can be stateless-signed plus a revocation check).

**Flow B payments (records only)**
- **PriceItem**: name, amount in piastres, currency, description, `archived_at`.
- **StudentPaymentRequest**: membership, price item snapshot, amount, method, reference, proof file, status, submitted by, links to the request it resubmits.
- **StudentPayment** (immutable ledger): membership, amount, currency, method, collector, request ID (nullable), price item name and amount snapshot, and `reversal_of` (nullable).
- **CashHandover**: collector, amount, the payments it covers, confirmed by and when.
- **Receipt**: counter per workspace, locked in the transaction so numbers have no gaps.

**Flow A**
- **PlatformPlan**: limits covering active students, video hours and staff.
- **SubscriptionPeriod**, **PlatformPayment**, **PlatformReceipt**.

**Assessment and grades**
- **Question** and **QuestionVersion** (immutable; LaTeX and images).
- **Assessment**: kind (homework, quiz or exam), target classes, settings.
- **AssessmentItem**: points to a question version.
- **Accommodation**.
- **Attempt**: deadline stored when the attempt starts; partial unique index for the one active attempt.
- **AttemptAnswer**: unique on (attempt, item), with a version.
- **Submission** and **SubmissionVersion**.
- **GradeItem**: class, category, max score, assessment (nullable, for paper items), release state.
- **GradeEntry**: with a version.
- **GradeChange**: history.
- **AttendanceRecord**: unique on (session, student membership).

**Cross-cutting**
- **Notification**, **IdempotencyKey**, **AuditLog** (partitioned).
- The job tables belong to pg-boss (schema `pgboss`); pg-boss jobs enqueued in the business transaction replace a separate outbox table.

## 6. Money and time conventions

- Money is stored as integer piastres plus an ISO currency code (EGP).
- Instants are stored as `timestamptz` in UTC. Recurrence uses local wall-clock time plus `Africa/Cairo`. Dates of birth and skip dates are `date`.
- IDs are UUIDv7. The platform student code is a separate short code designed for QR codes and watermarks.

## 7. Video pipeline and protection

The `VideoProvider` adapter exposes these operations:
- `createUpload()`;
- `onProcessed()`;
- `getPlayback(assetId, sessionId)`, which returns a manifest URL and the adapter's token or key mechanism;
- `delete()`.

Our own player (hls.js) is used with both adapters. It draws the moving watermark (student code and first name) and sends progress updates every 30–60 seconds.

A playback token is issued only after four checks pass: `AccessPolicy`, the pause flag, the concurrent-stream limit and the view limit.

### 7.1 `self-hls` (free setup, and a fallback)

1. **Upload.** The browser uploads straight to the private bucket using S3 multipart upload, which can be resumed.
2. **Transcode.** A job runs ffmpeg to produce HLS at 360p, 480p and 720p with 4-second segments.
   - Segments are **AES-128 encrypted with a new key every 5 minutes of content**.
   - Keys are stored encrypted in the database and never in the bucket.
   - On the free setup, the job runs on a developer machine using the same worker code (`pnpm worker transcode …`).
3. **Playlists.** `GET …/playback/{asset}/{rendition}.m3u8` re-checks the token and rewrites segment URIs as **presigned GET URLs** that expire at the video duration plus 30 minutes. Key URIs point to our API.
4. **Keys.** `GET …/keys/{asset}/{keyIndex}` requires the session cookie and a valid playback token, and **re-runs `AccessPolicy` and the pause check** every time. Keys rotate every 5 minutes, so a pause or removal stops playback within 5 minutes (REQ-VIDEO-001).
5. Segments without the key are useless, so the long-lived segment URLs don't weaken access control.

### 7.2 `bunny` (production default)

- Upload uses tus direct to Bunny Stream, and Bunny transcodes.
- Playback uses token-authenticated CDN URLs with a short expiry, issued by `getPlayback` after the same checks. The token isn't bound to the client IP, because mobile IPs change.
- The original is also copied to our own object storage.
- The paid DRM tier is the P3 upgrade path.

**Not allowed:** unlisted YouTube or any other public-link hosting (OD-06).

## 8. Environments and cost plan

Free tiers change frequently. The limits below reflect my understanding and **must be re-checked** (tracked as OQ-18) before each environment is set up.

### 8.1 (a) Zero-cost setup for development and demos (setups A and B)

| Component | Local development | Free cloud demo and staging |
|---|---|---|
| PostgreSQL 16 | Docker Compose | **Neon Free**, EU (Frankfurt) region |
| API and worker | Local processes | **Render Free** web service; the worker runs inline (`WORKER_MODE=inline`) |
| Web (Next.js) | Local | **Render Free** web service |
| Object storage | MinIO (Docker) | **Cloudflare R2** free tier |
| Video | `self-hls` with local ffmpeg | `self-hls`; transcoding runs on a developer machine and writes to R2 |
| Email | Mailpit (Docker) | **Resend Free** |
| OTP | `console` adapter (codes in the logs) | `console` adapter; seeded test phone range with fixed demo codes |
| Web push | VAPID (free) | VAPID (free) |
| Error tracking | — | **Sentry Developer** (free) |
| Uptime | — | **Better Stack Free** |
| CI | **GitHub Actions** free minutes | same |
| Domain | none | Provider subdomains |

**Monthly cost: $0.** R2 may require a payment method on file, but it charges nothing within the free limits.

Why not the obvious alternatives:
- **Vercel Hobby** is excluded because its terms restrict commercial use, and a demo to prospective paying teachers is commercial.
- **Unlisted YouTube** is excluded by OD-06.

Deployment files: `render.yaml` (Render blueprint for `lms-api` and `lms-web`) and the runbook [deploy-demo.md](deploy-demo.md). Demo data comes from `pnpm --filter @lms/api db:seed`. The accounts use the `0100000xxxx` block and include 2FA keys for the staff accounts. `TRUST_PROXY_HOPS` sets how many proxy hops the API trusts in `X-Forwarded-For` for client IPs (rate limits); the runbook explains how to check it.

### 8.2 (b) What the free tiers lack

| Gap | Where | Consequence | Mitigation |
|---|---|---|---|
| **No point-in-time recovery or real backups**; only a short restore window | Neon Free | Data loss is likely to be permanent | Synthetic data only (REQ-OPS-005, REQ-PRIV-006); the seed can be regenerated |
| **Sleeping.** Services spin down after about 15 minutes idle, and a cold start takes up to about a minute | Render Free | The first demo request is slow. The inline worker only runs while the service is awake, so scheduled jobs and notifications are delayed | Warm the service up before demos. Enforce exam deadlines on each request (REQ-EXAM-002), so correctness doesn't depend on the worker |
| **No separate background worker, and little CPU and RAM** | Render Free | Video can't be transcoded in the cloud | Transcode on a developer machine |
| **Database suspends when idle**, and storage is small (about 0.5 GB) | Neon Free | Small first-query delay; dataset size limited | Enough for demo data |
| **Storage and operation quotas** (about 10 GB) | R2 Free | About 5 hours of video (three renditions) | Keep demo content small; keep originals locally |
| **Email limits** (about 100 a day), and no custom sender without a verified domain | Resend Free | Demo emails can only reach the owners' own addresses | Email only matters for teachers and owners |
| **One seat, capped events** | Sentry Developer | Only one owner sees errors | Acceptable until setup C |
| **Commercial-use terms, SLA, DPA** | All free tiers | Usually no signed DPA or uptime commitment; some forbid commercial use | Check each provider's terms (OQ-18). **Never put real minors' data on free tiers** |
| **Uptime** | Render Free | Can't host real exams | Real use happens only on setup C |

### 8.3 (c) Minimum paid setup, required before any real teacher or student data

| Component | Choice | Approximate cost per month |
|---|---|---|
| Database | DigitalOcean Managed PostgreSQL, Frankfurt, 1 GB / 10 GB, daily backups plus 7-day point-in-time recovery | $15 |
| API | DigitalOcean App Platform, 1 GB container | $12 |
| Worker | App Platform, 512 MB (Bunny does the transcoding) | $5 |
| Web | App Platform, 1 GB container | $12 |
| Video | Bunny Stream, pilot with 50–150 students (volume network, storage plus delivery) | $3–15 |
| Object storage | R2: files and a copy of video originals | $0–5 |
| Off-site backups | Nightly encrypted `pg_dump` to Backblaze B2 with object lock, 30-day retention | $0–2 |
| Email | Resend Free, upgrading when volume exceeds about 3,000 a month | $0 |
| Error tracking | Sentry Developer, or Team ($26) once both owners need access | $0–26 |
| Uptime | Better Stack Free | $0 |
| OTP | WhatsApp authentication messages, billed per message (check Meta's rate for Egypt) | $5–15 |
| Domain | — | about $1 |
| **Total** | | **about $55–110 per month** |

Notes on setup C:
- Staging stays on the free setup with synthetic data.
- Setup C is the minimum technical setup for real data. Legal and accounting work is deferred (OD-08) and isn't a condition for moving to it.
- Moving from setup A to setup C changes environment variables and infrastructure only (REQ-OPS-006):

```
DATABASE_URL, STORAGE_ENDPOINT/BUCKET/KEYS, VIDEO_PROVIDER=self-hls|bunny,
EMAIL_PROVIDER=smtp|resend, OTP_PROVIDER=console|whatsapp|sms, ERROR_TRACKING=none|sentry,
WORKER_MODE=inline|separate, DATA_CLASS=synthetic|real, PUSH_VAPID_*
```

## 9. Tech stack

| Layer | Choice | Reason |
|---|---|---|
| Language | TypeScript (strict) | One language, shared Zod schemas between frontend and backend, and strong support from the AI coding agent |
| API | NestJS | Its modules match the modular monolith; guards implement the policies; it generates OpenAPI |
| Web | Next.js (App Router), used only as the web client | Server rendering for low-end Android, public pages, PWA |
| UI | Tailwind CSS (logical properties) and Radix/shadcn components | RTL support and small bundles |
| i18n | next-intl with ICU messages | Arabic plural forms; Arabic is the default locale |
| Database | PostgreSQL 16+ | Row-level security, partial unique indexes, row locks, partitioning |
| Data access | Drizzle ORM with SQL migrations | Composite foreign keys, partial indexes and `SET LOCAL` without workarounds |
| Jobs | pg-boss 12 | Jobs are enqueued in the same transaction as the business write (its Drizzle adapter), so no separate outbox is needed |
| Authentication | Hand-written (`modules/identity`): argon2id (`@node-rs/argon2`), opaque session tokens hashed with SHA-256, Postgres rate-limit counters (AD-07) | Rules are custom (phone-first, device caps, recycled numbers). Authorization is custom too |
| Maths | KaTeX | LaTeX in questions |
| Player | hls.js | One player for both video adapters; draws the watermark |
| Testing | Vitest, Testcontainers (Postgres), Playwright, axe-core, k6 | Covers the needs in the review's §18 |
| Monorepo | pnpm workspaces | `apps/api`, `apps/web`, `packages/shared` |

**Repository layout:**

```
apps/api           NestJS: src/modules/<module>/{controller,service,policy,queries,schema,index}
apps/api/src/database  DB handles (TenantDb, PlatformDb), migration runner, role check
apps/api/drizzle   SQL migrations (generated by drizzle-kit, custom SQL for roles and RLS)
apps/api/test      Integration tests against PostgreSQL (Testcontainers)
apps/web           Next.js: app/[locale]/(student|staff|platform|public)/...
packages/shared    Zod schemas, permission keys, error codes, i18n keys (created when first needed)
infra/dev          Local-only service configuration
docs/              requirements, architecture, decisions, open questions, dependencies
```

The database layer lives inside `apps/api` rather than a separate `packages/db`: only the API talks to the database, and keeping it in one package avoids a build step between packages.

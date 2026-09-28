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
- **Tenancy tables** (`modules/tenancy`, migration `0005`): `platform_owners` and `workspaces` are global and written only by the platform role (`WorkspacesService` creates a workspace, its owner membership and the audit event in one transaction). `memberships` and `workspace_invitations` are tenant tables. Database constraints enforce: one role per user per workspace; one owner per workspace; managed records are students with a provisional name and the student's own phone; only students can be paused, and a pause records who did it; internal codes are unique per workspace. `TenantDb.forUser(userId, …)` sets `app.user_id`, which lets a user **read** their own memberships across workspaces (the workspace switcher) and nothing else. Queries in that scope must select only the columns the user may see (for example, never `notes`). Class-teacher assignment is the class's `responsible_membership_id`, added with classes in Phase 4.
- **Sessions** are server-side, with device registrations, a cooldown and a concurrent-stream counter.
- **Passwords** are hashed with argon2id.
- **2FA (TOTP)** is required for platform owners, owner teachers and class teachers.
- **Support access**: read-only, time-limited, with a reason, audited, and visible to the teacher (REQ-RBAC-003).
- **User files** are served from a separate cookieless origin. Uploads start in quarantine and have their magic bytes checked. Images are re-encoded.
- **The isolation suite** (REQ-SEC-001) is generated from the OpenAPI specification. It tests every endpoint against every other-workspace actor and every out-of-scope actor.

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

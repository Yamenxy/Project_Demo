# Requirements

**Status:** Approved baseline for Phase 1. Last updated 2026-09-28.
**Sources:**
- the requirements prompt v3;
- the three-part review (finding IDs such as SEC-01 and DB-04 refer to it);
- the owner decisions OD-01 to OD-08 in [decisions.md](decisions.md).

Read this together with [architecture.md](architecture.md). Anything unresolved is in [open-questions.md](open-questions.md).

**Format.** Each entry is written as `REQ-<AREA>-<NNN> | ADD / CHANGE / REMOVE | MVP / Post-MVP`, with the requirement, testable acceptance criteria, and its source. ADD, CHANGE and REMOVE are relative to the original draft (prompt v3). Removed entries stay listed at the end of their area so the numbering stays traceable.

---

## 0. Changes caused by the owner decisions (2026-09-28)

| Effect | REQs |
|---|---|
| **Added** | AUTH-008, RBAC-006, USER-006, USER-007, CONTENT-005, CONTENT-006, CONTENT-007, CONTENT-008, CONTENT-009, CONTENT-010, CONTENT-011 (post-MVP), HW-002, EXAM-006, PAY-009, PAY-010, NOTIF-003, OPS-005, OPS-006, PRIV-006 |
| **Changed by OD-08** | PRIV-004 (legal and accounting work deferred until teachers are paying; no longer a launch condition) |
| **Changed** | AUTH-007, RBAC-001, RBAC-002, RBAC-004, USER-003, USER-005, CLASS-001, CONTENT-001, CONTENT-003, VIDEO-001, VIDEO-003, VIDEO-005, ATT-001, PAY-006, PAY-007, PAY-008, SUB-002, OPS-001, OPS-002, PRIV-004 |
| **Removed** | AUTH-006 (student-code login), PAY-001 (entitlement periods), PAY-002 (renewal arithmetic), PAY-005 (suspension compensation) |
| **Review findings dropped** | BIZ-01, BIZ-02, BIZ-04, EDGE-10, EDGE-12, the entitlement-stacking property tests in TEST-03, Flow B expiry reminders, the Flow B "Paid / Due / Overdue" billing status, and the permission keys `access.extend` and `payments.view_status` |

---

## Appendix A (normative). Roles, permission keys and matrix

### A.1 Roles

A role belongs to a membership in one workspace, never to the user globally (REQ-RBAC-001).

| Role | Description |
|---|---|
| **Platform owner** | One of the two operators. Has no access to workspace data except through a support session (REQ-RBAC-003). |
| **Owner teacher** (`owner`) | Owns the workspace and holds every workspace permission, including those that can't be delegated. |
| **Class teacher** (`class_teacher`) | A second teacher added by the owner. Manages only the classes the owner assigns them, and the courses linked to those classes (REQ-RBAC-006). |
| **Helper** (`assistant`) | A teacher assistant. Holds only the permission keys the owner grants, each optionally limited to specific classes (REQ-RBAC-002). |
| **Student** (`student`) | A learner in the workspace. |
| **Parent** | Post-MVP. |

### A.2 Permission keys

| Key | Grants | Can be class-scoped? |
|---|---|---|
| `enrollment.manage` | Approve join requests, enrol, transfer, remove from class | Yes |
| `students.edit` | Edit workspace fields (internal code, notes) | Yes |
| `students.import` | Bulk import (as invitations) | No |
| `students.sessions_reset` | Reset a student's devices and sessions | Yes |
| `attendance.mark` | Mark and edit attendance within 48 hours | Yes |
| `attendance.edit_late` | Edit attendance older than 48 hours, with a reason. Class teachers only. | Yes |
| `grading.grade` | Grade submissions and enter scores | Yes |
| `grading.release` | Release results and grades. Class teachers only in the MVP. | Yes |
| `content.edit` | Create and edit lessons and materials as drafts, upload files, preview | Yes (courses linked to scoped classes) |
| `content.publish` | Publish and unpublish lessons | Yes |
| `assessment.edit` | Question bank and assessments, including answer keys | Yes |
| `schedule.manage` | Create, reschedule and cancel sessions | Yes |
| `access.grants` | Grant, remove, block and unblock individual lessons for a student | Yes: students in scoped classes, lessons in linked courses |
| `access.groups` | Create and edit access groups, change their lessons and members | No (acts on the whole workspace) |
| `access.pause` | Pause and resume a student's access | Yes (limits which students) |
| `payments.record` | Record cash and direct payments | Yes |
| `payments.confirm` | Confirm or reject payment requests (not their own) | Yes |
| `payments.view` | See the payment records of students in scope (not totals) | Yes |
| `finance.view` | See income totals and per-collector cash reports | No |
| `announcements.post` | Post workspace and class announcements | Yes |
| `reports.academic` | See academic reports | Yes |
| `data.export` | CSV exports (audited) | Yes |

**Owner only (can't be delegated):**
- manage class teachers and helpers, and their permissions;
- the price list;
- workspace settings, subscription and cancellation;
- delete content;
- "remove from all groups and grants";
- the full workspace export;
- grade weighting and finalization (post-MVP).

**Class teacher default bundle**, scoped to their assigned classes and the courses linked to them:
`enrollment.manage`, `students.sessions_reset`, `attendance.mark`, `attendance.edit_late`, `grading.grade`, `grading.release`, `content.edit`, `content.publish`, `assessment.edit`, `schedule.manage`, `access.grants`, `payments.view`, `announcements.post`, `reports.academic`.

The owner may add further keys to a class teacher or a helper, except the owner-only actions above. Helpers can never hold `attendance.edit_late` or `grading.release` in the MVP.

### A.3 Matrix

Legend:
- ✅ allowed
- ❌ denied
- 🔑`key` means the permission key is required
- "scope" means limited to the assigned classes and their linked courses

| Action | Owner | Class teacher | Helper | Student | Platform owner |
|---|---|---|---|---|---|
| Manage staff and permissions | ✅ | ❌ | ❌ | ❌ | ❌ |
| Price list, workspace settings, subscription | ✅ | ❌ | ❌ | ❌ | Flow A billing only |
| Create and edit courses and lessons, upload | ✅ | ✅ scope | 🔑`content.edit` | ❌ | Support session, read-only |
| Publish and unpublish | ✅ | ✅ scope | 🔑`content.publish` | ❌ | ❌ |
| Delete content | ✅ | ❌ | ❌ | ❌ | ❌ |
| Individual lesson grants and blocks | ✅ | ✅ scope | 🔑`access.grants` | ❌ | ❌ |
| Access groups (create, lessons, members) | ✅ | 🔑`access.groups` | 🔑`access.groups` | ❌ | ❌ |
| Pause or resume a student | ✅ | 🔑`access.pause` | 🔑`access.pause` | ❌ | ❌ |
| Remove from all groups and grants | ✅ | ❌ | ❌ | ❌ | ❌ |
| Students tab | ✅ all | ✅ scope, sections per keys | Students in scope, sections per keys | ❌ | Support session, read-only |
| Schedule | ✅ | ✅ scope | 🔑`schedule.manage` | ❌ | ❌ |
| Attendance ≤ 48 hours / > 48 hours | ✅ / ✅ with reason | ✅ / ✅ with reason (scope) | 🔑`attendance.mark` / ❌ | ❌ | ❌ |
| Grade, enter scores | ✅ | ✅ scope | 🔑`grading.grade` | ❌ | ❌ |
| Release grades and results | ✅ | ✅ scope | ❌ | ❌ | ❌ |
| Record a payment | ✅ | 🔑`payments.record` | 🔑`payments.record` | ❌ | ❌ |
| Confirm or reject a payment request | ✅ | 🔑`payments.confirm` | 🔑`payments.confirm` (not own) | ❌ | ❌ |
| View payment records of students in scope | ✅ | ✅ scope | 🔑`payments.view` | ✅ own | Support session |
| View income and cash per collector | ✅ | 🔑`finance.view` | 🔑`finance.view` | ❌ | ❌ |
| Submit a payment request | — | — | — | ✅ | — |
| Watch a lesson | Preview | Preview (scope) | Preview with `content.edit` | Per AccessPolicy | ❌ |
| Take exams, submit homework | — | — | — | Enrolled in a targeted class and not paused | — |
| View the workspace audit log | ✅ | ❌ | ❌ | ❌ | ✅ |
| Start a support session | ❌ | ❌ | ❌ | ❌ | ✅ reason, time limit, teacher notified |

---

## AUTH

### REQ-AUTH-001 | ADD | MVP
**Requirement:** A phone number is verified by OTP (WhatsApp first, SMS as fallback) before it can be used to log in or to recover the account. A number that isn't verified never blocks another person from verifying it.
**Acceptance criteria:**
- The OTP has 6 digits, is valid for 5 minutes, and can be used once.
- At most 5 sends per phone per hour, and 5 wrong attempts before a 15-minute lockout.
- Verifying a number held unverified by another account removes the number from that account and notifies it.
**Source:** SEC-02, UX-08

### REQ-AUTH-002 | ADD | MVP
**Requirement:** Workspace staff may reset a student's password only when the account is **managed**: its only membership is in their workspace, and the student has never verified it. Every other account recovers through its own verified channel or through a platform owner.
**Acceptance criteria:**
- Resetting an account that belongs to another workspace is refused and audited.
- A successful reset revokes all sessions and forces a password change.
- The isolation suite includes the scenario of taking over an account from another workspace.
**Source:** SEC-01

### REQ-AUTH-003 | ADD | MVP
**Requirement:** An account with activity in the last 12 months can't be recovered by OTP alone. Recovery also needs the old password, staff confirmation (managed accounts only), or a check by platform support.
**Acceptance criteria:** A test simulating a recycled phone number fails to take over the account, and the user is shown a "contact support" path.
**Source:** EDGE-01

### REQ-AUTH-004 | ADD | MVP
**Requirement:** Sessions are opaque server-side tokens. Logout, "log out everywhere", removing a membership and changing permissions take effect within 5 seconds.
**Acceptance criteria:** A removed helper's next request fails. A permission change applies to the next request.
**Source:** SEC-04

### REQ-AUTH-005 | CHANGE | MVP
**Requirement:** Student device limits are platform-wide per account (default 2). A student can revoke their own devices, but may register at most 2 new devices per 30 days. Each workspace sets a concurrent-stream limit (default 1).
**Acceptance criteria:**
- A third device is blocked, and the screen lists the active devices.
- A third new device within 30 days is blocked until staff or support resets it.
- A second concurrent stream stops the first.
**Source:** CON-01, UX-09

### REQ-AUTH-006 | REMOVE | —
**Requirement:** Removed: login with the platform student code for students without their own phone.
**Source:** OD-05

### REQ-AUTH-007 | CHANGE | MVP
**Requirement:** TOTP two-factor authentication is mandatory for platform owners, owner teachers and class teachers, with recovery codes. It is optional for helpers.
**Acceptance criteria:** An owner or class teacher can't reach workspace data until 2FA is set up. Recovery codes can each be used once.
**Source:** SEC-06, OD-01

### REQ-AUTH-008 | ADD | MVP
**Requirement:** Every student account has its own phone number, which is required and unique across the platform. Email is optional. The guardian phone is a contact field only; it isn't unique and can't be used to log in.
**Acceptance criteria:**
- Student registration without a phone is rejected.
- A second account with the same verified phone is rejected.
- Two siblings can have the same guardian phone.
**Source:** OD-05, D34

---

## RBAC

### REQ-RBAC-001 | CHANGE | MVP
**Requirement:** A role comes from the membership in the workspace named in the URL. The roles are `owner`, `class_teacher`, `assistant` (helper) and `student`. A user has at most one role per workspace; the same user can hold different roles in different workspaces.
**Acceptance criteria:**
- The same user acts correctly as a helper in workspace A and as a student in workspace B.
- A database constraint rejects a second role for the same user in the same workspace.
**Source:** RBAC-04, OD-01

### REQ-RBAC-002 | CHANGE | MVP
**Requirement:** Helper permissions come from the keys in Appendix A.2. Each grant can be limited to specific classes. Owner-only actions can't be granted to anyone.
**Acceptance criteria:**
- A helper scoped to class X gets 404 for class Y's roster, attendance and payments.
- No API or UI path grants an owner-only action.
**Source:** RBAC-01, RBAC-05, OD-01

### REQ-RBAC-003 | CHANGE | MVP
**Requirement:** Support access requires a reason and a ticket reference, lasts at most 60 minutes, and is read-only. Starting it notifies the owner teacher and the other platform owner. The session and the records it viewed appear in the workspace audit log.
**Acceptance criteria:**
- Writes during a support session return 403.
- Without a support session, a platform owner gets 404 for workspace data.
- The owner teacher can see the support entries.
**Source:** SEC-05, CON-08

### REQ-RBAC-004 | CHANGE | MVP
**Requirement:** In a suspended workspace, the owner can only use billing, renewal, data export and read-only views. Class teachers and helpers can do nothing. Students see only their own grades, attendance and payment history, in read-only form, with a neutral message.
**Acceptance criteria:** A test matrix calls every endpoint in the suspended state and checks the result above.
**Source:** RBAC-06, CON-11, OD-01

### REQ-RBAC-005 | ADD | MVP
**Requirement:** Every endpoint declares a policy, and access is denied by default.
**Acceptance criteria:** CI fails when an endpoint has no declared policy or no isolation test case.
**Source:** RBAC-07, TEST-01

### REQ-RBAC-006 | ADD | MVP
**Requirement:** The owner can invite a **class teacher**, assign classes to them, and change or remove those assignments. A class teacher holds the default bundle in Appendix A.2, scoped to their assigned classes and the courses linked to them. The owner may add further keys, except owner-only actions.
**Acceptance criteria:**
- A class teacher can't see students, sessions, grades or payment records outside their scope (404).
- Removing a class assignment ends that access on the next request.
- A class teacher counts toward the plan's staff limit (see open question OQ-06).
**Source:** OD-01

---

## USER

### REQ-USER-001 | CHANGE | MVP
**Requirement:** These are separate state machines:
- account: Pending, Active, Suspended, Archived, Anonymized;
- membership: Pending, Active, Suspended, Removed;
- subscription: Trial, Active, Grace, Lapsed, Cancelled;
- workspace suspension: a flag with reason `billing` or `admin`.

Pausing access (REQ-CONTENT-008) is a separate flag on the membership, not a membership state.
**Acceptance criteria:**
- A test for each allowed and each forbidden transition.
- A payment clears only a `billing` suspension.
- Pausing doesn't change the membership state.
**Source:** CON-03, OD-03

### REQ-USER-002 | CHANGE | MVP
**Requirement:** Bulk import accepts XLSX and CSV (with encoding detection) and normalizes phone numbers to E.164. A row that matches an existing account creates an invitation, and the import report never reveals that an account exists. Rows without a student phone are rejected (REQ-AUTH-008).
**Acceptance criteria:**
- `1012345678` becomes `+201012345678`.
- Arabic-Indic digits are normalized.
- The report shows the same status whether or not the account exists.
- Files in Windows-1256 encoding import correctly.
**Source:** SEC-02, CON-12, UX-12, OD-05

### REQ-USER-003 | CHANGE | MVP
**Requirement:** Staff can create a **managed** student record without a login. The record must include the student's own phone. The student claims it by OTP to that phone and keeps the history.
**Acceptance criteria:**
- After the claim, the attendance, grades, payments, group memberships and grants recorded before it are all on the student's account.
- The claim is audited.
**Source:** Q5, MISS-15, OD-05

### REQ-USER-004 | ADD | MVP
**Requirement:** The user owns global profile fields: name, phone, date of birth. Staff edit only fields on the workspace membership.
**Acceptance criteria:**
- Staff changes to global fields return 403.
- Membership changes are audited.
- A change to the global name appears in every workspace.
**Source:** DB-02

### REQ-USER-005 | CHANGE | MVP
**Requirement:** Class teachers and helpers join through a phone-based invitation that they accept with a global account. Removing them revokes their workspace access immediately.
**Acceptance criteria:** Invitations expire after 7 days. After removal, requests fail within 5 seconds.
**Source:** MISS-13, OD-01

### REQ-USER-006 | ADD | MVP
**Requirement:** A **Students tab** lists the students in the viewer's scope, with search and filters (class, group, paused, name, phone, code). Each student's page shows:
- workspace fields and classes;
- access groups;
- pause state;
- **every lesson they can access, with each reason**: "via Group X" (one entry per group), "individual grant", or blocked by "individual block" or "paused";
- payment records with receipts;
- attendance;
- grades.

Each section is shown only if the viewer holds the matching key (`payments.view`, `reports.academic`, and so on).
**Acceptance criteria:**
- A student in groups A (lessons 1, 2, 3) and B (lessons 2, 3, 5) shows lesson 2 as "via A, via B".
- A blocked lesson shows "blocked" even when a group includes it.
- A paused student shows every lesson as blocked by pause, with the underlying reasons still listed.
- p95 under 800 ms for a student with 500 lessons.
**Source:** OD-03

### REQ-USER-007 | ADD | MVP
**Requirement:** In the Students list, staff can select many students (up to 500 per operation) and apply **pause, resume, add to group, or remove from group**, subject to their permissions and scope.
**Acceptance criteria:**
- Each bulk operation runs in one transaction and is idempotent.
- The result reports how many students changed and how many were already in that state.
- Students outside the actor's scope are rejected, and none of the operation is applied.
**Source:** OD-03

---

## CLASS

### REQ-CLASS-001 | CHANGE | MVP
**Requirement:** Each class has one **responsible teacher**: the owner or an assigned class teacher. Helpers work on a class through their scope. A student may not be in two active classes linked to the same course unless a teacher overrides it. There is no co-teachers field.
**Acceptance criteria:**
- Assigning a class to a class teacher makes them its responsible teacher.
- A second enrolment on the same course is rejected without an override, and an override is audited.
**Source:** CON-06, CON-07, OD-01

---

## SCHED

### REQ-SCHED-001 | CHANGE | MVP
**Requirement:** A recurring series stores its local wall-clock time and the IANA timezone. Occurrences are generated as UTC instants. Pure dates are stored as `date`.
**Acceptance criteria:** A Saturday 17:00 Cairo series stays at 17:00 local time across Egypt's DST changes.
**Source:** CON-02, EDGE-14

### REQ-SCHED-002 | CHANGE | MVP
**Requirement:** The academic calendar is replaced by a per-workspace list of holidays and skip dates. The only conflict check is a warning about overlapping sessions for the same responsible teacher.
**Acceptance criteria:** Occurrences on listed dates are skipped. An overlap shows a warning and isn't blocked.
**Source:** BIZ-13

---

## CONTENT and ACCESS

### REQ-CONTENT-001 | CHANGE | MVP
**Requirement:** The unit of access is the **lesson**. A lesson's video and attachments follow the lesson. A single `AccessPolicy` decides whether student S can access lesson L. Access is granted only when all of these hold:
- S has an active student membership in the workspace;
- L is published;
- the workspace isn't suspended;
- S isn't paused;
- S has no individual block on L;
- S is in at least one access group that includes L, **or** S has an individual grant for L.

Staff holding `content.edit` in scope can preview any lesson in scope, including drafts, without these rules. Every endpoint for lessons, files, playback tokens, playlists and video keys calls `AccessPolicy`, and results are never cached across requests.
**Acceptance criteria:**
- A table-driven test covers every term.
- A block beats both a group and a grant. A pause beats everything.
- An unpublished lesson is refused even with a grant.
- A lint rule or review check fails any content endpoint that doesn't call `AccessPolicy`.
**Source:** OD-02, SEC-07

### REQ-CONTENT-002 | CHANGE | MVP
**Requirement:** The 30-day content versioning is replaced by soft delete that can be restored for 30 days.
**Acceptance criteria:** A deleted lesson can be restored for 30 days and is removed permanently afterwards. Its groups and grants are restored with it.
**Source:** §16

### REQ-CONTENT-003 | CHANGE | MVP
**Requirement:** Each workspace has a public page at `/t/{slug}` showing the teacher, subjects, the **price list** (REQ-PAY-006), and join and sign-up actions. No student data appears on it.
**Acceptance criteria:** The page loads without logging in, meets the performance budget, and exposes no personal data.
**Source:** MISS-06, OD-04

### REQ-CONTENT-004 | ADD | Post-MVP
**Requirement:** A lesson can require a prerequisite: passing a specific quiz, or watching a percentage of a previous lesson. The prerequisite is an extra condition on top of REQ-CONTENT-001.
**Acceptance criteria:** A locked lesson shows the requirement and unlocks when it is met.
**Source:** MISS-03

### REQ-CONTENT-005 | ADD | MVP
**Requirement:** Staff with `access.grants` can **grant**, **remove a grant**, **block** or **unblock** a lesson for a student. There is at most one individual rule per (student, lesson), and it is either a grant or a block; setting one replaces the other.
**Acceptance criteria:**
- Granting then blocking leaves only the block.
- A unique constraint prevents duplicate rules.
- Each change is audited.
- A class teacher can't grant a lesson from a course that isn't linked to their classes.
**Source:** OD-02

### REQ-CONTENT-006 | ADD | MVP
**Requirement:** Staff with `access.groups` can create, rename and archive **access groups**, choose the lessons in each group, and add or remove students. A student may belong to many groups. Groups are separate from classes. Archiving a group removes its effect on access but keeps its history.
**Acceptance criteria:**
- With group A = {1, 2, 3} and group B = {2, 3, 5}, a student in both can access {1, 2, 3, 5}.
- Removing lesson 5 from B removes access to 5 for any student with no other path to it, on their next request.
- Archiving is audited, and an archived group can be restored.
**Source:** OD-02

### REQ-CONTENT-007 | ADD | MVP
**Requirement:** A group has an **"add all students from class X"** shortcut. It adds the class's currently active enrolments once; it isn't a live link, so later enrolments are not added automatically.
**Acceptance criteria:**
- Running it twice changes nothing the second time.
- Students already in the group are unchanged.
- The audit entry records the class and the number of students added.
**Source:** OD-02; the live-link option is OQ-04

### REQ-CONTENT-008 | ADD | MVP
**Requirement:** **"Pause all access"** is a toggle on a student membership, with an optional reason. While paused:
- no lessons, files or playback tokens are served;
- ongoing playback stops at the next token or key check, within 5 minutes;
- new homework submissions and new exam attempts are refused;
- grades, attendance, submissions and payment records stay visible.

Group memberships and individual rules are kept. **Resuming** restores exactly the access the student had before.
**Acceptance criteria:**
- Pause and then resume produces an identical access set.
- A paused student's playback key request returns 403.
- Pause and resume are each audited, with the actor and reason.
- The attendance scan shows amber for a paused student.
**Source:** OD-03

### REQ-CONTENT-009 | ADD | MVP
**Requirement:** **"Remove from all groups and grants"** (owner only) removes all of a student's group memberships and individual grants. Individual blocks are kept, so access stays denied by default. Class enrolments and the pause flag are unchanged. The action requires the owner to type a confirmation.
**Acceptance criteria:**
- After the action, the student has no group memberships and no grants.
- The audit entry lists every removed membership and grant, so the state can be rebuilt by hand.
- A helper or class teacher gets 403.
**Source:** OD-03

### REQ-CONTENT-010 | ADD | MVP
**Requirement:** Every access change supports bulk selection: grants, blocks, group membership, group lessons, pause and resume. Each operation runs in one transaction, is idempotent, and writes one audit event with the details for each student and lesson affected.
**Acceptance criteria:**
- Granting 50 lessons to 200 students completes in under 5 seconds.
- Repeating the operation changes nothing.
- The audit event lists every affected (student, lesson) pair.
**Source:** OD-02

### REQ-CONTENT-011 | ADD | Post-MVP
**Requirement:** Grants and group memberships can have an optional end date, after which they stop counting.
**Acceptance criteria:** After the end date, `AccessPolicy` ignores the grant or membership, without needing a job.
**Source:** OD-02

---

## VIDEO

### REQ-VIDEO-001 | CHANGE | MVP
**Requirement:** Playback requires a short-lived token (at most 10 minutes) that is bound to the session. The token is issued only after `AccessPolicy`, the concurrent-stream limit and the view limit pass. Video is delivered as HLS and can't be fetched without a valid token. Every adapter must provide:
- **`self-hls`** (the free setup): AES-128 encrypted HLS, with the key served only by our API after re-checking the session and `AccessPolicy`, keys rotated every 5 minutes of content, and segments in a private bucket behind presigned URLs;
- **`bunny`** (production): token-authenticated URLs that expire, played in our own player.

The spec states that this makes downloading harder but does not prevent it.
**Acceptance criteria:**
- A token from another session is rejected.
- A pause or removal stops playback within 5 minutes.
- Direct segment or playlist URLs without a valid token fail.
- Every token and key request is logged, and a report flags accounts that fetch a whole video faster than 4× real time.
**Source:** SEC-07, OD-06

### REQ-VIDEO-002 | CHANGE | MVP
**Requirement:** Our player draws a moving watermark with the platform student code and first name. It never shows the phone number.
**Acceptance criteria:** The watermark is visible in every playback mode, including fullscreen, with both adapters.
**Source:** SEC-08

### REQ-VIDEO-003 | CHANGE | MVP
**Requirement:** Staff can set an optional view limit per lesson, counted by accumulated watch time and checked when a playback token is issued (after `AccessPolicy`). Staff with `access.grants` can reset it for a student.
**Acceptance criteria:** Once watched time reaches N × the lesson duration, playback is blocked with a message. Resets are audited.
**Source:** MISS-04

### REQ-VIDEO-004 | ADD | MVP
**Requirement:** Default quality is at most 480p on cellular or when Save-Data is on. The quality selector shows the approximate data used per hour. Playback starts at the lowest rendition.
**Acceptance criteria:** Covered by a manual test on an Android phone using mobile data. The player remembers the student's choice.
**Source:** UX-01, PERF-05

### REQ-VIDEO-005 | CHANGE | MVP
**Requirement:** Video goes through a `VideoProvider` adapter with two implementations: `self-hls` (ffmpeg plus S3-compatible storage; used for development, demos and as a fallback) and `bunny` (Bunny Stream; the production default). Configuration chooses the adapter. Originals are also kept in platform object storage.
**Acceptance criteria:**
- The same end-to-end playback test passes with both adapters.
- Switching the adapter requires no code change.
- Every processed video has an original in platform storage.
**Source:** SCALE-01, OPS-05, OD-06

---

## FILE

### REQ-FILE-001 | ADD | MVP
**Requirement:** Uploads go directly to storage and start in quarantine. A job checks the file's magic bytes and size and re-encodes images before the file is marked available. User files are served from a separate cookieless origin, with `Content-Disposition: attachment` for types that aren't images. Files attached to a lesson are served only through `AccessPolicy`.
**Acceptance criteria:**
- A file renamed to look like a different type is rejected.
- The EXIF location is removed.
- An uploaded HTML or SVG file never runs on the app's origin.
**Source:** §15.3, 3.11

---

## QBANK

### REQ-QBANK-001 | ADD | MVP
**Requirement:** Question text, choices and feedback support LaTeX maths (rendered with KaTeX) and images, mixed with RTL Arabic.
**Acceptance criteria:** A physics question mixing Arabic text and an inline formula renders correctly on Android Chrome.
**Source:** MISS-02

### REQ-QBANK-002 | CHANGE | MVP
**Requirement:** Editing a question that has been used creates a new immutable version. Assessment items and answers point to a specific version.
**Acceptance criteria:** Editing a question after an attempt changes neither the attempt's displayed question nor its score.
**Source:** DB-10

### REQ-QBANK-003 | ADD | MVP
**Requirement:** Short-answer exact-match grading normalizes digits, whitespace and (if the teacher enables it) Arabic letter variants before comparing.
**Acceptance criteria:** When the key is "5", both "٥" and " 5 " are marked correct. With letter normalization on, "طاقه" matches "طاقة".
**Source:** UX-02

---

## HW

### REQ-HW-001 | CHANGE | MVP
**Requirement:** The late policy is either reject or accept with a flag. Resubmission is on or off, with at most one resubmission. Late penalties are post-MVP.
**Acceptance criteria:** Transitions follow the transition table. A resubmission graded after release replaces the released score, and the old score stays in history.
**Source:** §16, EDGE-23

### REQ-HW-002 | ADD | MVP
**Requirement:** A student can submit homework only when they are actively enrolled in a class the homework targets **and** are not paused. Access groups don't gate homework.
**Acceptance criteria:** A paused student's submission is refused with a neutral message. Their earlier submissions and grades stay visible.
**Source:** OD-03; the interpretation is confirmed in OQ-03

---

## EXAM

### REQ-EXAM-001 | CHANGE | MVP
**Requirement:** MVP exam settings are: a fixed question set, shuffling of questions and choices, a time limit, an availability window, an attempt limit, highest or latest score counts, accommodations and auto-submit. Random draws, negative marking and averaging are post-MVP.
**Acceptance criteria:** Each setting is covered by tests. Settings that aren't supported are rejected by the API.
**Source:** §16

### REQ-EXAM-002 | ADD | MVP
**Requirement:** The attempt deadline is computed once, at start: the earlier of (start + time limit + accommodation) and the window end, with accommodations allowed to extend past the window end. Answers are accepted until the deadline plus 60 seconds of network grace. The deadline is also enforced whenever a request arrives, so correctness doesn't depend on the sweeper; the sweeper auto-submits within 60 seconds.
**Acceptance criteria:**
- Time-travel tests cover the late-start rule and accommodations.
- An answer at deadline + 61 seconds is rejected.
- With the worker stopped, an expired attempt is still closed on its next request.
**Source:** DB-05, EDGE-20, SEC-09

### REQ-EXAM-003 | ADD | MVP
**Requirement:** Once any attempt exists, only answer-key corrections are allowed, and they trigger a regrade. The teacher previews how many scores and pass/fail outcomes change before confirming.
**Acceptance criteria:** Structural edits are blocked after the first attempt. A regrade is audited and sends one notification per student.
**Source:** EDGE-19, EDGE-21

### REQ-EXAM-004 | ADD | MVP
**Requirement:** The exam client keeps answers in a local queue and retries them with idempotency, and shows saved or unsaved status on each question. The timer uses the server deadline, corrected for clock offset. No answer keys or correctness data are sent before results are released.
**Acceptance criteria:**
- An answer given while offline for 2 minutes is saved on reconnect.
- Changing the device clock has no effect.
- API responses contain no correctness data.
**Source:** UX-04, PERF-04, SEC-09

### REQ-EXAM-005 | ADD | MVP
**Requirement:** Exam performance targets: start p95 under 500 ms with 200 starts per minute (1,500 per minute at year-three scale), autosave p95 under 300 ms, and zero lost acknowledged answers.
**Acceptance criteria:** The k6 profiles pass on a staging environment sized like production, before each release that touches assessments.
**Source:** PERF-03, TEST-06

### REQ-EXAM-006 | ADD | MVP
**Requirement:** A student can start an exam attempt only when they are actively enrolled in a class the exam targets **and** are not paused. An attempt already in progress when the student is paused may finish before its deadline.
**Acceptance criteria:**
- A paused student gets a neutral refusal on start.
- An attempt started before the pause can still be submitted before its deadline.
**Source:** OD-03, BIZ-03

---

## ATT

### REQ-ATT-001 | CHANGE | MVP
**Requirement:** A session opened while online caches its roster on the device. QR scanning then works offline, with green (ok), amber (paused, or not enrolled in the class) and red (unknown code). Scans upload later as idempotent upserts keyed by (session, student).
**Acceptance criteria:**
- 150 scans made offline sync on reconnect with no duplicates.
- A paused student shows amber.
**Source:** UX-05, OD-03

### REQ-ATT-002 | ADD | MVP
**Requirement:** Cancelling a session that has attendance requires confirmation. The records are kept, flagged, and excluded from attendance percentages.
**Acceptance criteria:** Reports exclude the cancelled session. The cancellation is audited.
**Source:** EDGE-16

---

## GRADE

### REQ-GRADE-001 | ADD | MVP
**Requirement:** Staff can create grade items that aren't linked to an online assessment, for paper exams and centre quizzes, and enter scores in bulk on a grid.
**Acceptance criteria:**
- Scores for 100 students can be entered on a phone.
- Online and paper items appear together in reports.
- Edits after release require a reason and are audited.
**Source:** MISS-01, DB-09

### REQ-GRADE-002 | CHANGE | MVP
**Requirement:** The MVP gradebook has grade items, scores, release control, change history with a reason, and per-student and per-class averages. Weighting and finalization are post-MVP.
**Acceptance criteria:**
- Every change stores the old value, the new value, who made it and the reason.
- Unreleased grades are invisible to students (API test).
**Source:** §16, BIZ-08

### REQ-GRADE-003 | ADD | MVP
**Requirement:** When a student transfers, their grade entries stay with the original class. The student's report shows every class they belonged to.
**Acceptance criteria:** After a transfer, the old scores are visible on the student's report and in the old class's reports.
**Source:** BIZ-07

---

## PAY (Flow B: student → teacher, records only)

### REQ-PAY-001 | REMOVE | —
**Requirement:** Removed: access derived from entitlement periods. Access is now granted manually (REQ-CONTENT-001).
**Source:** OD-02, OD-04

### REQ-PAY-002 | REMOVE | —
**Requirement:** Removed: renewal arithmetic (extend from the end date or from now; calendar months).
**Source:** OD-04

### REQ-PAY-003 | CHANGE | MVP
**Requirement:** A **recorded payment** (cash taken by staff) is effective immediately and stores who collected it. A **payment request** (submitted by the student) needs approval from someone other than its submitter. Staff record cash handovers, and the owner confirms them.
**Acceptance criteria:**
- Each payment shows its collector.
- The per-collector daily total equals the sum of that collector's payments.
- An approver can't approve their own request.
**Source:** CON-04, MISS-07

### REQ-PAY-004 | ADD | MVP
**Requirement:** Every confirmed or recorded payment produces an in-app receipt with a receipt number per workspace.
**Acceptance criteria:** Receipt numbers have no gaps under concurrent approvals. The student sees all their receipts.
**Source:** MISS-08, DB-06

### REQ-PAY-005 | REMOVE | —
**Requirement:** Removed: automatic compensation after a teacher suspension. Access isn't time-based, so nothing is lost.
**Source:** OD-02, OD-04

### REQ-PAY-006 | CHANGE | MVP
**Requirement:** The owner keeps a **price list** of items, each with a name, an amount in integer piastres, a currency and an optional description. It is shown on the public page. Recording a payment can start from a price item, which pre-fills the amount; the actual amount received is what gets recorded (D20). The item's name and price are copied onto the payment. Items are archived, never deleted.
**Acceptance criteria:**
- Changing a price doesn't change past payments.
- Archived items are hidden from the public page but still appear on the payments that used them.
- Amounts are stored as integers.
**Source:** DB-03, EDGE-07, EDGE-13, OD-04

### REQ-PAY-007 | CHANGE | MVP
**Requirement:** The payment ledger is immutable. A refund or a correction is recorded as a **reversal entry**. Removing access is a separate action on access (REQ-CONTENT-005 to REQ-CONTENT-009), not a payment action.
**Acceptance criteria:** Income reports net out reversals. The database role has no UPDATE or DELETE on the ledger.
**Source:** BIZ-05, OD-04

### REQ-PAY-008 | CHANGE | MVP
**Requirement:** Approving a payment request re-checks the approver's permission and the workspace state inside the transaction, and produces **exactly one** ledger entry and one receipt, even under concurrent approvals.
**Acceptance criteria:** 20 parallel approvals produce one ledger entry and one receipt. An approver whose permission was just revoked gets 403.
**Source:** EDGE-08, TEST-04, OD-04

### REQ-PAY-009 | ADD | MVP
**Requirement:** Payments **never change access**. After a payment is recorded or approved, the UI offers shortcuts: "Resume access" (if the student is paused) and "Add to group…". Each shortcut runs the normal access action, with its own permission check and audit entry.
**Acceptance criteria:**
- Recording a payment for a paused student leaves them paused until someone uses the shortcut.
- The shortcuts are hidden from users who lack `access.pause` or `access.groups`.
**Source:** OD-04

### REQ-PAY-010 | ADD | MVP
**Requirement:** Students can submit payment requests with a proof image, method, reference and amount. They can cancel a request before it's reviewed. A rejection carries a reason. A resubmission links to the rejected request (D19). Within the workspace, duplicate reference numbers and exact-duplicate proof images are flagged, never blocked. Proofs are visible only to staff with `payments.confirm`.
**Acceptance criteria:**
- A reused reference number shows a warning on both requests.
- A proof link expires within 10 minutes.
- Each state change is audited.
**Source:** 3.18, SEC-14, EDGE-09, OD-04

---

## SUB (Flow A: teacher → platform)

### REQ-SUB-001 | CHANGE | MVP
**Requirement:** Platform owners set each workspace's plan and subscription end date, and record Flow A payments with an audit entry. Grace, suspension and reminders then run automatically. Teacher-submitted requests are post-MVP.
**Acceptance criteria:**
- The workspace moves into grace at the end date and is suspended 7 days later.
- Recording a payment reactivates it immediately.
- An owner can't approve a payment they recorded themselves.
**Source:** §16

### REQ-SUB-002 | CHANGE | MVP
**Requirement:** Plans are tiered by **active students**: students with at least one group membership or individual grant who are not paused. Each tier has a video-hours allowance and a staff limit (class teachers plus helpers). Limits are soft: a warning at 80%, and at 100% new active students and new uploads are blocked. Existing students are never cut off.
**Acceptance criteria:**
- Pausing a student lowers the active count immediately.
- At 100%, adding a new student to a group fails with a clear message, and existing students keep their access.
**Source:** SCALE-01, MISS-09, OD-04

---

## NOTIF

### REQ-NOTIF-001 | CHANGE | MVP
**Requirement:** The app asks for push permission after a meaningful action. Bulk notifications go through the queue at a limited rate. In-app notifications are the reliable record.
**Acceptance criteria:**
- The permission prompt never appears on first load.
- A 2,000-recipient announcement is sent in about 15 seconds without an API spike.
**Source:** UX-11, SCALE-02

### REQ-NOTIF-002 | ADD | MVP
**Requirement:** Staff screens show "message via WhatsApp" links (`wa.me` with prefilled Arabic text) for student and guardian phones, only to users allowed to see those phones.
**Acceptance criteria:** The link opens WhatsApp with the prefilled text and is hidden when the viewer lacks phone visibility.
**Source:** UX-11, PRIV-09

### REQ-NOTIF-003 | CHANGE | MVP
**Requirement:** Notifications about a lesson ("new lesson", "lesson now available to you") go only to students who have effective access when the notification is created. A bulk access operation sends **at most one** notification per student. Flow B "access expiring" and "payment due" notifications are removed. Pausing a student sends no notification.
**Acceptance criteria:**
- Publishing a lesson notifies only students with access.
- Granting 10 lessons to a student creates one notification.
- A paused student receives no lesson notifications.
**Source:** OD-02, OD-04

---

## MSG

### REQ-MSG-001 | CHANGE | MVP
**Requirement:** In the MVP, homework comments are the only channel between staff and students. They are retained according to the retention table, can be reviewed by the owner, and can be reported.
**Acceptance criteria:** There's no other path for staff to message students. A report reaches the platform owners' queue.
**Source:** PRIV-10

---

## REPORT

### REQ-REPORT-001 | ADD | MVP
**Requirement:** CSV exports are UTF-8 with a BOM, cells starting with `=`, `+`, `-` or `@` are neutralized, and every export is audited.
**Acceptance criteria:** Arabic opens correctly in Excel. A formula-looking name exports as inert text.
**Source:** SEC-10

### REQ-REPORT-002 | ADD | MVP
**Requirement:** A cash report per collector and per day, with the status of handovers.
**Acceptance criteria:** It is visible only to the owner and to holders of `finance.view`. Its totals match the ledger.
**Source:** MISS-07

---

## AUDIT

### REQ-AUDIT-001 | CHANGE | MVP
**Requirement:** Audit entries store user IDs instead of personal data wherever possible. Context that is personal data goes in a field that can be cleared. The application's database role can only insert into and read the audit table.
**Acceptance criteria:**
- After anonymization, no audit row contains the person's name or phone.
- An UPDATE from the application role fails.
**Source:** SEC-11, SEC-12

### REQ-AUDIT-002 | CHANGE | MVP
**Requirement:** The owner teacher can see all audit events in their workspace, including support sessions and the records those sessions viewed. Every access change (REQ-CONTENT-005 to REQ-CONTENT-010) is audited.
**Acceptance criteria:**
- The owner sees support entries.
- Each access operation produces exactly one audit event, containing its details.
**Source:** CON-08, OD-02

---

## DATA

### REQ-DATA-001 | ADD | MVP
**Requirement:** Every tenant table has `workspace_id NOT NULL`. Foreign keys between tenant tables are composite: (workspace ID, ID). Row-level security is enforced through `SET LOCAL app.workspace_id` in every transaction. Only a named platform handle can bypass scoping, and it is lint-restricted and logged.
**Acceptance criteria:**
- A cross-workspace reference fails in the database.
- A pooled-connection test that interleaves two tenants leaks nothing.
**Source:** DB-01, SEC-03, SCALE-05

### REQ-DATA-002 | ADD | MVP
**Requirement:** Each concurrency hotspot is protected by its mechanism from DB-08. Additions for the access model:
- a unique constraint on (group, student);
- a unique constraint on (group, lesson);
- a unique constraint on (student, lesson) for individual rules;
- pausing is a conditional update.

**Acceptance criteria:** Parallel tests show no duplicate rows and consistent final states.
**Source:** DB-08, OD-02

### REQ-DATA-003 | ADD | MVP
**Requirement:** Mutating endpoints used by students and staff accept an idempotency key, which is kept for 24 hours.
**Acceptance criteria:** Resending a request with the same key returns the original response and has no second effect.
**Source:** §13

### REQ-DATA-004 | ADD | MVP
**Requirement:** The audit log and notifications tables are partitioned by month from the first migration.
**Acceptance criteria:** Partitions are created ahead of time, and the retention job drops expired partitions.
**Source:** SCALE-06

---

## SEC

### REQ-SEC-001 | ADD | MVP
**Requirement:** Accessing a resource in another workspace, or outside the actor's class scope, returns 404. An automated cross-tenant and cross-scope suite, generated from the application's route table (AD-08), runs on every pull request.
**Acceptance criteria:** The suite covers 100% of endpoints, including class-teacher and helper scopes, and CI fails on any gap.
**Source:** TEST-01, OD-01

### REQ-SEC-002 | ADD | MVP (before general launch)
**Requirement:** An external penetration test focused on tenant isolation and identity is done before general launch, and its findings are fixed.
**Acceptance criteria:** A report is on file, with every critical or high finding closed.
**Source:** TEST-09

---

## OPS

### REQ-OPS-001 | CHANGE | MVP (paid setup)
**Requirement:** Once real data is stored (setup C in the architecture), the database has point-in-time recovery, plus nightly encrypted dumps kept for 30 days in object storage at a different provider and account, written with object lock. An automated restore test runs every month and a manual recovery drill runs every quarter. The free setup has no backup requirement, because it holds only synthetic data.
**Acceptance criteria:**
- A missing backup raises an alert within 24 hours.
- The measured restore time is under 4 hours.
**Source:** OPS-05, OPS-06, OD-06

### REQ-OPS-002 | CHANGE | MVP
**Requirement:** The alerts from OPS-04 are configured on the paid setup, each with a runbook. On the free setup, the minimum is error tracking plus an uptime check.
**Acceptance criteria:** Each alert is test-fired once.
**Source:** OPS-04, OD-06

### REQ-OPS-003 | ADD | MVP
**Requirement:** CI gates cover lint, type checking, tests, the isolation suite, performance budgets and dependency and secret scans. Production deploys need manual approval and are blocked while an exam is open.
**Acceptance criteria:** A pull request that breaks any gate can't merge. The deploy job refuses to run during an open exam.
**Source:** OPS-02, PERF-01

### REQ-OPS-004 | ADD | MVP
**Requirement:** A written runbook for incidents and breaches, with notification templates, is practised before any real data is stored.
**Acceptance criteria:** The drill is completed, and the question "who, which workspaces, which data" is answered from the logs within 24 hours.
**Source:** OPS-08, PRIV-08

### REQ-OPS-005 | ADD | MVP
**Requirement:** There are three environment tiers:
- **(A) local and free demo:** synthetic data only;
- **(B) staging:** stays on the free setup, synthetic data only;
- **(C) production:** the minimum paid setup (architecture §8.3), required before any real teacher or student data is stored.

**Acceptance criteria:**
- Seed data is generated.
- The configuration for setups A and B refuses to start without `DATA_CLASS=synthetic`.
- Moving to setup C is a documented checklist.
**Source:** OD-06, 3.34

### REQ-OPS-006 | ADD | MVP
**Requirement:** Every external provider sits behind an adapter selected by configuration: database URL, object storage (S3-compatible), video, email, OTP, push, error tracking and the clock.
**Acceptance criteria:**
- Each adapter has a fake used in tests.
- Moving setup A to setup C changes only environment variables and infrastructure, not application code.
**Source:** OD-06

---

## PRIV

### REQ-PRIV-001 | CHANGE | MVP
**Requirement:** Students under 18 need guardian consent, verified by OTP to the guardian's phone or by a signed paper form uploaded by staff. Until consent exists, the account is limited, for at most 14 days.
**Acceptance criteria:**
- A consent record stores the version, the method and the time.
- A limited account can't upload files.
- The owner dashboard lists students with missing consent.
**Source:** PRIV-01, MISS-11

### REQ-PRIV-002 | ADD | MVP
**Requirement:** The retention table from PRIV-06 is enforced by a nightly job. Proof images and submission files follow their shorter periods.
**Acceptance criteria:** Test data older than each period is anonymized or deleted as specified. Each run is audited.
**Source:** PRIV-06, CON-05

### REQ-PRIV-003 | ADD | MVP
**Requirement:** In-app data subject requests: export my data, correct global fields, and delete my account (a 14-day cooling-off period, then anonymization).
**Acceptance criteria:**
- The export contains only the requester's own data.
- Deletion anonymizes the account and notifies the owner teachers.
**Source:** PRIV-07

### REQ-PRIV-004 | CHANGE | Deferred (post-launch)
**Requirement:** Legal and accounting advice is deferred until teachers are paying (OD-08). It covers:
- controller and processor roles;
- the licence from the PDPC;
- appointing a data protection officer;
- cross-border hosting;
- the consent method;
- tax on Flow A revenue.

It doesn't block development, the pilot or launch. The privacy protections in REQ-PRIV-001, REQ-PRIV-002, REQ-PRIV-003, REQ-PRIV-005, REQ-PRIV-006 and REQ-VIDEO-002 are product requirements and are built regardless.
**Acceptance criteria:** The items are listed in the "Later, once teachers are paying" section of open-questions.md.
**Source:** PRIV-02, PRIV-03, PRIV-04, COMP-01, OD-07, OD-08

### REQ-PRIV-005 | ADD | MVP
**Requirement:** Personal data is visible only as set out in the PRIV-09 matrix. Class teachers and helpers see phone numbers only for students in scope, and only with `enrollment.manage` or `students.edit`.
**Acceptance criteria:** API tests show that phone numbers and dates of birth are absent from responses to roles without access.
**Source:** PRIV-09, OD-01

### REQ-PRIV-006 | ADD | MVP
**Requirement:** Real personal data is never stored on the free setups A and B. Demos use generated Arabic synthetic data.
**Acceptance criteria:** Covered by REQ-OPS-005. The demo seed contains no real phone numbers; it uses a reserved test range.
**Source:** OD-06, 3.34

---

## I18N and A11Y

### REQ-I18N-001 | ADD | MVP
**Requirement:** Mixed-direction content is isolated with `dir="auto"` or `<bdi>`. Western digits are the default display, with Arabic-Indic digits as a preference. Every numeric input is normalized on the server.
**Acceptance criteria:**
- "18/20" displays correctly inside Arabic text.
- An OTP typed with Arabic-Indic digits is accepted.
- RTL snapshot tests pass.
**Source:** UX-02, TEST-07

### REQ-I18N-002 | ADD | MVP
**Requirement:** Messages use ICU format, including the Arabic plural categories. Hard-coded user-facing strings fail lint. Mirroring follows UX-03, with media controls not mirrored.
**Acceptance criteria:** The lint rule fails on a raw string. Arabic plural forms render correctly.
**Source:** UX-03

### REQ-A11Y-001 | CHANGE | MVP
**Requirement:** WCAG 2.1 AA is the target. Automated axe checks run on the student flows (login, lesson, exam, payment request). Captions are post-MVP.
**Acceptance criteria:** No serious or critical axe violations on those flows, and the exam can be completed using only a keyboard.
**Source:** TEST-08

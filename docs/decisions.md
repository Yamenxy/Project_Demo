# Decision log

A short record of product decisions. Newer decisions win over older ones.
Requirements that implement a decision are in [requirements.md](requirements.md); anything still undecided is in [open-questions.md](open-questions.md).

Statuses:
- **Active**: in force as written.
- **Revised**: in force, with the change noted.
- **Superseded**: replaced by a later decision.
- **Moot**: no longer applies because of a later decision.

---

## Owner decisions (2026-09-28)

These were made after the three-part requirements review. Where they conflict with the review, these win.

| ID | Date | Decision | Answers | Main REQs |
|---|---|---|---|---|
| OD-01 | 2026-09-28 | **Workspace and roles.** A workspace belongs to one owner teacher, who is the admin over its students. The owner can add **class teachers**: a second teacher who manages only their own classes inside the workspace. The owner can add **helpers** (teacher assistants) with configurable permissions, class scopes and non-delegable actions. | Q1, Q7 | RBAC-001, RBAC-002, RBAC-006, CLASS-001, USER-005 |
| OD-02 | 2026-09-28 | **Access model.** Access is granted manually by the teacher, never by payments or plans. There are three mechanisms: individual grants or blocks per lesson, access groups (a set of lessons plus a set of students, where a student can be in many groups), and a "pause all access" switch per student. Effective access = (in a group with the lesson OR individually granted) AND NOT individually blocked AND NOT paused AND lesson published AND workspace not suspended. Grants have no automatic expiry in the MVP; optional end dates are post-MVP. Every change is audited and can be done in bulk. One AccessPolicy serves every content, file and video endpoint. | Q2 | CONTENT-001, CONTENT-005 to CONTENT-011 |
| OD-03 | 2026-09-28 | **Students tab.** Each student's page shows their groups, every lesson they can access and why, payment records, attendance and grades. Actions: pause all access (keeps groups, restorable in one click), remove from all groups and grants (permanent, with confirmation), and bulk pause, resume, add to group, remove from group. | — | USER-006, USER-007, CONTENT-008, CONTENT-009 |
| OD-04 | 2026-09-28 | **Flow B payments are records only.** They never grant access. After a payment is recorded, the UI offers "resume access / add to group". Kept from the review: cash collector tracking and handover, payment requests with proof, receipts, integer piastres, reversals. Student "plans" become a simple **price list**. Entitlements, renewal arithmetic and suspension compensation are removed. An **active student** (Q9) is one with any group membership or grant who is not paused. | Q9 | PAY-006 to PAY-010, SUB-002; removes PAY-001, PAY-002, PAY-005 |
| OD-05 | 2026-09-28 | **Phones.** One phone number = one student account, and every student must have their own phone. The guardian phone is a contact field only and may repeat across siblings. Student-code login is removed. | Q3 | AUTH-008, USER-003; removes AUTH-006 |
| OD-06 | 2026-09-28 | **Platform and cost.** PWA only; no native app within 12 months, so DRM and Capacitor stay P3. Until there are paying customers, development and demos run on free tiers. Video protection (access checks, short-lived tokens, watermark) must work on the free setup; public-link hosting such as unlisted YouTube is not allowed. Every provider sits behind an adapter so switching is a configuration change. | Q4 | VIDEO-001, VIDEO-005, OPS-001, OPS-005, OPS-006, PRIV-006 |
| OD-07 | 2026-09-28 | **Everything else from the review stands**, including: the §16 MVP cuts and the two-release plan, the §15.4 stack, the identity fixes, tenant isolation, exams, attendance, the gradebook, privacy and testing. The legal workstream (lawyer, accountant) and the Egyptian network video test are **owner tasks that are tracked, not blocking** for development. The legal part is superseded by OD-08. | — | PRIV-004; see open-questions.md |
| OD-08 | 2026-09-28 | **Legal and accounting work is deferred** (OQ-11 to OQ-16) until teachers are paying. It doesn't block the pilot or launch, and there's no legal sign-off step in any launch checklist. The privacy protections in the product (guardian consent flow, data minimization, retention and deletion rules, no phone numbers in watermarks) stay as requirements. Supersedes the legal part of OD-07. | — | PRIV-004 |
| OD-09 | 2026-09-29 | **The product is a sales demo for now: no paid services.** Everything free is built properly; each paid service (WhatsApp/SMS codes, email provider, Bunny video, managed hosting with backups, Sentry seats, domain, penetration test) is deferred and tracked in paid-services.md, with the free replacement the demo uses. | — | paid-services.md |

## Review defaults adopted through OD-07 (2026-09-28)

| ID | Decision | Source |
|---|---|---|
| AD-01 | **Managed student records** (no login yet) are allowed; the student claims the record later by OTP. Under OD-05, a managed record must hold the student's own phone. | Q5 |
| AD-02 | **Paper and offline assessments** are graded in the platform as grade items that are not linked to an online assessment. | Q6 |
| AD-03 | The **controller and processor** split (platform is controller for global accounts, teacher is controller for workspace data) is the working assumption. Legal review is deferred (OD-08). | Q8 |
| AD-04 | **Tenancy:** shared database and shared schema, `workspace_id` on every tenant row, composite foreign keys, row-level security as a backstop. | Review §7.1 |
| AD-05 | **Stack:** TypeScript, NestJS API, Next.js web, PostgreSQL with Drizzle, pg-boss, Better Auth (authentication only). | Review §15.4 |
| AD-07 | **Authentication is a small hand-written module, not Better Auth** (2026-09-29, Phase 1 task 8). It uses argon2id password hashing (`@node-rs/argon2`, OWASP parameters) and 256-bit random session tokens stored only as SHA-256 hashes. Reason: the rules are custom (phone-first accounts, unverified numbers that never block the real owner, a device cap with a cooldown, managed-account resets, recycled-number recovery, an audit event on every step), so Better Auth would be bypassed for most flows while adding its own schema and routes. | Review §15.4, AD-05 |
| AD-08 | **The cross-tenant suite enumerates routes from the application's own route table, not from an OpenAPI file** (2026-09-29, Phase 1 task 14). It covers every route just as completely, and fails when a new route parameter has no fixture. OpenAPI generation (`@nestjs/swagger`) arrives with the Phase 2 API surface, for documentation and the web client. | REQ-SEC-001 |
| AD-06 | **Release plan:** Release 1 (foundation, students, classes, attendance, Flow B records, content and access) goes to a pilot teacher at about month 3. Release 2 (assessments, gradebook, reports) goes to general launch at about months 5–6. Flow A is simplified until there are about 30 teachers. | Review §16 |

## Original decisions D1–D34 (recorded 2026-09-28, from requirements prompt v3)

| ID | Topic | Status | Current rule |
|---|---|---|---|
| D1 | Course vs class | Active | A course is reusable content. A class is a group of students on a schedule, linked to one course. |
| D2 | Student joins several teachers | Active | One global account, many workspace memberships. |
| D3 | Several classes with the same teacher | Active | Allowed. |
| D4 | Two classes on the same subject | Revised | A student may not be in two active classes **linked to the same course** unless a teacher overrides it (REQ-CLASS-001). |
| D5 | One teacher per class | Revised (OD-01) | Each class has one **responsible teacher**: the owner or a class teacher. Helpers assist through their class scope. |
| D6 | Who transfers students | Revised (OD-01) | The owner, the class teacher (within their classes), and helpers with `enrollment.manage`. |
| D7 | Capacity and waitlist | Active | Optional capacity per class. The waitlist is post-MVP. |
| D8 | Joining a teacher | Active | By invite link or code, with approval (or auto-approve). Imports create invitations (REQ-USER-002). |
| D9 | Physical centres | Active | Each teacher keeps their own location list. No platform-level centre management. |
| D10 | When paid access ends | Superseded (OD-02, OD-03) | There's no paid-access expiry. When a student is **paused**, lessons, files, new homework submissions and new exam attempts are blocked. Their grades, attendance, submissions and payments stay visible. |
| D11 | Student grace period | Moot (OD-02) | There's no expiry to grace. |
| D12 | Rewatching after access ends | Superseded (OD-02) | Access to a lesson lasts until the teacher removes, blocks or pauses it. |
| D12a | Teacher subscription lapses | Revised | 7-day grace, then the workspace is suspended with a neutral message. The teacher can only renew or export. Students keep read-only access to their own grades, attendance and payment history (REQ-RBAC-004). |
| D12b | Student time lost during a teacher suspension | Moot (OD-02) | Access isn't time-based, so there's nothing to compensate. |
| D12c | Data retention after a teacher leaves | Revised | Governed by the retention table (REQ-PRIV-002). Content is deleted 90 days after cancellation; academic records are anonymized per the table. |
| D13 | Device and session limits | Revised | Platform-wide per account (default 2 devices), with a device-registration cooldown. Each teacher sets a concurrent-stream limit (REQ-AUTH-005). |
| D14 | Video watermark | Revised | A moving watermark showing the **platform student code and first name**, never the phone number (REQ-VIDEO-002). |
| D15 | Downloads | Active | Video is stream-only. PDFs are downloadable if the teacher allows it. |
| D16 | Payment methods | Active | Cash, InstaPay, mobile wallets, bank transfer, Fawry. Platform owners configure the list. |
| D17 | Currency | Active | EGP only. Amounts are stored as integer piastres with a currency code. |
| D18 | Who approves payments | Active | Flow A: platform owners only. Flow B: the owner teacher and staff with `payments.confirm`. Nobody approves their own request. Recorded (cash) payments are a separate kind of entry (REQ-PAY-003). |
| D19 | Resubmitting a rejected payment | Active | A new request linked to the rejected one. |
| D20 | Amount differs from price | Revised (OD-04) | The approver records the actual amount received. Payments have no effect on access. |
| D21 | Modifying finalized grades | Active (post-MVP) | Finalization is post-MVP. In the MVP every score edit after release needs a reason and is audited. |
| D22 | Editing past attendance | Revised (OD-01) | The owner and class teachers (within their classes): any time, with a reason after 48 hours. Helpers: within 48 hours only. Always audited. |
| D23 | Exam retakes | Revised | Attempt limit per exam. Highest or latest score counts; averaging is post-MVP. |
| D24 | Connection loss during an exam | Active | Server-side timer, autosave, resume, auto-submit (REQ-EXAM-002, REQ-EXAM-004). |
| D25 | Proctoring | Active | None. The platform says so clearly. |
| D26 | Attendance as a graded component | Post-MVP | Grade weighting is post-MVP. |
| D27 | Who creates student accounts | Active | Students self-register. Staff create managed records and import (as invitations). |
| D28 | Parental consent | Revised | Guardian consent is verified by OTP to the guardian's phone, or by a signed paper form (REQ-PRIV-001). |
| D29 | Parent accounts | Active (post-MVP) | One parent can link many students, and a student can have many parents. |
| D30 | Account deletion | Active | Personal data is anonymized. Records are kept per the retention table. |
| D31 | Retention periods | Superseded | Replaced by the retention table (REQ-PRIV-002). |
| D32 | Languages | Revised | Arabic (default, RTL) and English. Western digits by default, Arabic-Indic digits as a preference, and every numeric input normalized (REQ-I18N-001). |
| D33 | Timezone | Revised | Instants are stored in UTC. Recurring schedules are stored as local wall-clock time plus `Africa/Cairo`. Pure dates are stored as dates (REQ-SCHED-001). |
| D34 | Login identifier | Revised (OD-05) | Phone number (required for every student, one account per phone) or email. |

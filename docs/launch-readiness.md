# Launch readiness

Status on 2026-09-30, after Phase 9. For the owners, before showing the product and before the
first real customer.

## The short answer

- **Ready to demo, today.** Every MVP feature is built and tested. The full journey below runs
  end to end in a real browser.
- **Not ready for real customers tomorrow.** Some blockers aren't code: nobody can sign up in
  production without an SMS or WhatsApp provider, and real data needs the paid setup with backups.
  Several need approvals from Meta, domain setup or a tester. Plan on **2 to 4 weeks** for the
  must-do list, mostly waiting on outside parties. A small pilot with one friendly teacher can
  start once the first seven items are done.

## Must do before any real customer data

| # | What | Why | Who | Size |
|---|---|---|---|---|
| 1 | **Make this code the main line.** `main` on GitHub is an older, unrelated project (.NET `EducationPlatform.Api`). This platform lives on the phase branches; `phase-9/hardening` has all of it. Decide whether to replace `main` or keep the old one under another name. | Deployments and pull requests start from `main`. | Owners | 1 hour |
| 2 | **Run the checks on Linux (CI).** CI has never run: it only runs on pull requests and `main`. Everything was verified on one Windows PC. Opening a pull request runs lint, type checks, all tests, the browser tests, a dependency audit and a secret scan on Linux, which is what production runs. | Linux can differ (file-name case, paths, fonts). | Developer | 1 day, plus fixes if anything fails |
| 3 | **SMS or WhatsApp codes.** Write the `WhatsAppOtpSender` and an SMS fallback (paid-services.md). The production config refuses the development senders, so **without this nobody can register or reset a password.** | Phone verification is how everyone signs up. | Owners (Meta business verification, template approval, SMS account) and developer (about 2 days of code) | 1–3 weeks waiting on Meta |
| 4 | **The paid setup (setup C).** Managed PostgreSQL with point-in-time recovery, nightly encrypted off-site dumps, and alerts for missing backups (REQ-OPS-001, -002). Then run `scripts/restore-drill.sh`'s steps against the real backups. | Real data needs backups and restores that were tested. | Owners and developer | 2–3 days |
| 5 | **File storage in the cloud.** Write the S3-compatible `FileStorage` adapter (Cloudflare R2). Today files sit on the API server's disk, which is lost on redeploys and can't be shared by two servers. | Uploads (homework, payment proofs, lesson files) would disappear. | Developer | 1–2 days |
| 6 | **Domain, HTTPS and email.** Buy the domain, point the app and a separate files domain at it, and add an email provider (Resend) with a verified sender. | Emails to teachers (security alerts, support-session notices) and a trustworthy address. | Owners and developer | 1–2 days |
| 7 | **Secrets per environment.** Generate a new `SECRET_ENCRYPTION_KEY` (the app refuses the repo's example keys outside local) and database passwords, and a VAPID key pair if push is turned on. Keep them in the host's secret settings, never in the repo (the repo is **public**). | Security. | Developer | Hours |
| 8 | **Privacy policy and terms pages.** The app collects data about minors and has none. The text needs your lawyer; adding the pages and links is small. | Legal basis and trust. The retention and deletion rules are built and need to be described. | Owners and lawyer | Lawyer time, plus half a day |
| 9 | **Error tracking and an uptime check** (Sentry, Better Stack or similar). | You need to know when something breaks before a teacher calls. | Developer | Half a day |
| 10 | **Load test on the real servers.** Locally, exam start and autosave meet the targets at 200 starts a minute but not at the year-three rate (1,500 a minute) on one laptop process; nothing was lost either way (`load/README.md`). Repeat on the production-sized setup. | Exam day is the riskiest moment. | Developer | 1 day |
| 11 | **Incident runbook and one drill** (REQ-OPS-004): who does what if data leaks or the site is down, with message templates. | Required before real data. | Owners | 1 day |
| 12 | **External penetration test** (REQ-SEC-002), focused on workspace isolation and sign-in. Required before general launch; a closed pilot can start before it. | An outside check of the security model. | A freelance tester | 1–2 weeks elapsed |

Legal and accounting advice (OQ-11 to OQ-16) was deliberately deferred until teachers pay (OD-08).
Because the users are mostly minors, get at least the guardian-consent method (OQ-14) and the
privacy policy (item 8) reviewed before the pilot.

## Should do soon (product gaps, not blockers)

- **Video on a CDN.** The free `self-hls` adapter transcodes on the API server (heavy on its CPU,
  uploads capped at 200 MB). Write the Bunny Stream adapter after the network test on Egyptian
  carriers (OQ-17). The concurrent-stream limit and segment encryption come with it.
- **Image re-encoding of uploads** (needs an image library) and serving files from the separate
  cookieless domain (item 6).
- **Retention for cancelled workspaces**: there is no "workspace cancelled" state yet, so the
  rules that depend on it aren't enforced (`docs/retention.md`).
- **The owner's full workspace export**, per-type push settings, images in questions, and an iOS
  camera QR scanner (typed codes work on iPhones).
- **Unpaid-students report** (OQ-07) and an automatic "all students" group for new members
  (OQ-08): both likely to come up in the pilot.
- **Password resets for active accounts need support** (OQ-22, the safest option). Watch how often
  it happens in the pilot.
- **API documentation (OpenAPI)** for any future mobile app.

## Open product questions (defaults are built; confirm in the pilot)

OQ-01 class-teacher permissions, OQ-02 money between owner and class teacher, OQ-04 "add class to
group" as a one-time copy, OQ-05 pause scope with two teachers, OQ-06 staff limits, OQ-09 students
who share a parent's phone, OQ-10 blocks kept on "remove all", OQ-22 password resets. Details and
defaults are in `open-questions.md`.

## What's built

Accounts with phone verification, two-step verification for teachers, device limits and guardian
consent; teacher workspaces with staff and fine-grained permissions; students joining by code or
import; classes, weekly schedules and attendance with an offline QR scanner; the price list, cash
and transfer payments with receipts, payment requests with proofs, cash handovers and reports;
courses, lessons, files and protected video with a watermark and view limits; access groups and
per-student rules; the question bank with maths, timed online exams that survive bad connections,
answer-key corrections, homework with comments, and the gradebook; announcements, lesson
notifications, web push and an installable app; CSV exports; the platform console with billing,
support sessions and comment reports; the owner's activity log; privacy requests (download,
correct, delete) and the retention job. Arabic first, English second, right-to-left throughout.

Tests: about 430 API tests against a real PostgreSQL (including a check that every route refuses
other workspaces, and a suspended-workspace matrix), 43 browser tests including accessibility checks
and the full journey, and 43 unit tests.

## Showing it: the full journey

`apps/web/e2e/full-journey.spec.ts` is one test that tells the whole story in the real app, in
Arabic, with a teacher and a student side by side:

1. The student joins with the teacher's code; the teacher approves.
2. The teacher writes a course and publishes a lesson.
3. The teacher makes a class and adds the student.
4. An access group opens the lesson, and the student reads it.
5. The teacher takes attendance.
6. A cash payment is recorded; the student opens the receipt.
7. The student takes an online exam; the teacher releases the results into the gradebook.
8. Homework is submitted, graded with feedback, and discussed in comments.
9. An announcement reaches the student as a notification.
10. The owner checks the activity log.

To watch it run in a visible browser (PowerShell, from the repository root, with Docker running):

```powershell
docker compose up -d
pnpm --filter @lms/api build
pnpm --filter @lms/web build
$env:DEMO_SLOWMO = 600
pnpm --filter @lms/web test:demo
```

Leave out the `DEMO_SLOWMO` line for full speed (about 15 seconds). The HTML report with every step
opens with `pnpm --filter @lms/web exec playwright show-report`.

# Open questions and owner tasks

Last updated 2026-09-28. Every item has a **default** that development follows until the item is answered. When an item is answered, move it to [decisions.md](decisions.md) and update [requirements.md](requirements.md).

"Blocks" says what can't happen until the item is resolved. Unless stated otherwise, **nothing here blocks development** (OD-07).

---

## Product questions (answer before the affected phase)

| ID | Question | Default until answered | Affects | Needed by |
|---|---|---|---|---|
| OQ-01 | Is the **class teacher default bundle** right (Appendix A.2)? In particular, should a class teacher be able to grant individual lessons, release grades and edit attendance older than 48 hours in their own classes without extra keys? | Yes, as listed. The owner can add keys, but not owner-only actions. | RBAC-006 | Phase 2 |
| OQ-02 | **Money between the owner and a class teacher.** Whose income are a class teacher's students' payments? Should a class teacher see income for their own classes? Is there a revenue split? | All Flow B records belong to the workspace. A class teacher sees payment records for students in their scope (`payments.view`) but no totals unless granted `finance.view`. No split feature. | PAY, REPORT | Phase 4 |
| OQ-03 | Should homework and exams be gated only by **class enrolment plus pause**, and not by access groups? | Yes (REQ-HW-002, REQ-EXAM-006). | HW, EXAM | Phase 6 |
| OQ-04 | Is **"add all students from class X"** a one-time copy, or a live link that also adds future enrolments? | One-time copy (REQ-CONTENT-007). A live link can be added later. | CONTENT-007 | Phase 5 |
| OQ-05 | **Pause scope when a workspace has two teachers.** Pausing is workspace-wide, so a student who stops paying the owner also loses the class teacher's lessons. Should pause be per class teacher? | Workspace-wide pause. The key `access.pause` isn't in the class teacher's default bundle. | CONTENT-008 | Phase 5 |
| OQ-06 | Do class teachers count toward the plan's **staff limit**, and is a workspace with a class teacher priced differently? | They count toward the staff limit, with no separate price. | SUB-002 | Phase 2 |
| OQ-07 | **Tracking unpaid students** (recommended). Add an optional "month covered" field to payment records, plus a report "students who aren't paused and have no payment for month M", with bulk pause from that report. It never grants access automatically. | Not built. The Students tab shows payment records only. | PAY, REPORT | Phase 4 |
| OQ-08 | **Free previews and new students.** With manual access, a newly approved student sees nothing. Should there be an optional "all students" group that new members join automatically? | No automatic group. Teachers add new students to groups by hand or in bulk. | CONTENT-006 | Phase 5 |
| OQ-09 | **Students without their own phone.** Younger students and siblings often share a parent's phone. With one phone per account, a second sibling can't register, and a student who uses the parent's phone as their own can confirm the guardian consent OTP themselves. | Registration rejects a student phone equal to their own guardian phone when the student is under 18, and asks for paper consent instead. Registration failures of this kind are measured during the pilot. | AUTH-008, PRIV-001 | Phase 2 |
| OQ-10 | Should **"remove from all groups and grants"** also delete individual **blocks**? | No. Blocks are kept, so access stays denied by default. | CONTENT-009 | Phase 5 |

## Owner tasks: legal and compliance (tracked, not blocking development)

Strong recommendation: get at least an initial written opinion on OQ-11 to OQ-14 **before any real student data is stored** on setup C.

| ID | Task | Who | Status | Blocks |
|---|---|---|---|---|
| OQ-11 | Lawyer: confirm the **controller and processor** split (the platform for global accounts, the teacher for workspace data) and the data processing terms in the teacher agreement. | Owners and an Egyptian lawyer | Open | Teacher terms |
| OQ-12 | Lawyer: status of the PDPL Executive Regulations; whether a **licence or permit from the PDPC** is needed and in which category; fees; appointing and registering a **data protection officer**. | Owners and lawyer | Open | Real-data launch (recommended) |
| OQ-13 | Lawyer: **cross-border transfer**. Hosting in Frankfurt (DigitalOcean), video on Bunny (EU), and US SaaS tools (Sentry, Resend): is a transfer licence needed, and does it matter that the data belongs to minors? | Owners and lawyer | Open | Choice of hosting region for setup C |
| OQ-14 | Lawyer: is the **guardian consent method** (OTP to the guardian's phone, or a signed paper form) valid as explicit written consent for sensitive children's data? Is consent needed once per platform or per teacher? | Owners and lawyer | Open | REQ-PRIV-001 wording |
| OQ-15 | Lawyer: rules on **private tutoring** that could affect the platform or its teachers (confidence: low). | Owners and lawyer | Open | — |
| OQ-16 | Accountant: **legal entity**, VAT registration threshold, and the Egyptian Tax Authority's **e-invoice and e-receipt** obligations for Flow A revenue; the retention period for financial records. | Owners and accountant | Open | Charging the first teacher |

## Owner tasks: technical and operational

| ID | Task | Who | Status | Blocks |
|---|---|---|---|---|
| OQ-17 | **Video test on Egyptian networks.** Measure video start time and rebuffering on Vodafone, Orange, e& and WE (4G and ADSL) for Bunny's volume network, Bunny's standard network, and R2 with the Cloudflare CDN. Confirm or change the production video adapter. | Owners | Open | Production video provider (not development: `self-hls` works first) |
| OQ-18 | **Verify free-tier and pricing terms**: Render, Neon, R2, Resend, Sentry, Better Stack (limits and commercial-use terms), and DigitalOcean and Bunny prices for setup C. | Owners | Open | Deploying setup A in the cloud |
| OQ-19 | **WhatsApp OTP**: Meta business verification (it may need the legal entity from OQ-16), a sender number, approval of the authentication message template, and the per-message price for Egypt. Pick an SMS fallback provider. | Owners | Open | Real OTP on setup C (development uses the `console` adapter) |
| OQ-20 | **Domain name** for the app, the separate files origin and the email sender. | Owners | Open | Custom email sender, setup C |
| OQ-21 | **Recruit a pilot teacher.** Also use the pilot to check the review's assumptions: watch hours per student (A-11), how common paper exams are (A-06), and how often students share phones (OQ-09). | Owners | Open | Release 1 pilot |

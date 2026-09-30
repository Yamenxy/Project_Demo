# Phase 8 plan: announcements, push, reports

Goal: the last Release 2 features before general launch (AD-06): reaching students, the installable
app, and the reports teachers take away. Everything free; paid items stay in
[paid-services.md](../paid-services.md).

| # | Task | Requirements | Modules |
|---|---|---|---|
| 8.1 | Announcements to a workspace or a class (`announcements.post`), delivered as in-app notifications by a queue job in limited batches | REQ-NOTIF-001 | announcements (new), notify, jobs, web |
| 8.2 | Lesson notifications: publishing, or opening access to, a lesson notifies only students with effective access at that moment; a bulk access change sends at most one per student; paused students get none | REQ-NOTIF-003 | content, notify |
| 8.3 | Installable app and web push: manifest and service worker (offline shell, so the attendance scanner reopens offline), push subscriptions behind an adapter, the permission asked only after a meaningful action, pushes sent from the queue | REQ-NOTIF-001, REQ-ATT-001 | notify, web |
| 8.4 | CSV exports (UTF-8 with BOM, formula-looking cells neutralised, every export audited, `data.export`) and the cash report per collector and day with handover status (`finance.view`) | REQ-REPORT-001, REQ-REPORT-002 | reports (new), payments, web |
| 8.5 | "Message via WhatsApp" links (`wa.me`, prefilled Arabic) for student and guardian phones, only for viewers allowed to see them | REQ-NOTIF-002 | web, tenancy |

Each task ships with tests (integration against Postgres, cross-tenant suite, browser flow where
there's UI), audit events, translations in Arabic and English, and doc updates.

**Risks:** notification storms (batches with a pause, one notification per student per bulk
change); leaking phone numbers through links (same visibility rule as the students tab); CSV
injection (neutralised cells, tested).

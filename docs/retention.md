# Retention

The authoritative retention table (review PRIV-06, REQ-PRIV-002). The nightly `retention.run` job
(`apps/api/src/modules/platform-admin/retention.service.ts`, 01:00 UTC) applies the rules marked
**Enforced**, and records each run in the audit log (`retention.run`, with counts). Account
deletion requests are handled separately by `privacy.anonymize` (REQ-PRIV-003, AD-13).

| Data | Retention | Then | Status |
|---|---|---|---|
| Global account (profile, credentials) | While active; **3 years with no activity** | Anonymize (D30) | **Enforced.** Activity is the latest of creation, profile change and session use. Workspace owners and platform owners are left to the platform team. |
| Workspace academic records (grades, attendance, attempt answers, homework comments) | **3 years after the student's last activity in the workspace**, or 12 months after the workspace is cancelled, whichever comes first | Anonymize the student link; keep aggregates | Not yet: needs a "cancelled workspace" state and a design for unlinking one workspace's records from an account that stays active elsewhere. |
| Homework submission files, attempt photo uploads | **12 months** after the assessment closes | Delete the files; keep the scores | **Enforced** for homework files (12 months after the due date). Exams have no photo uploads. |
| Payment proof images (both flows) | **12 months** after the decision | Delete | **Enforced** (withdrawn requests: 12 months after the request). |
| Payment ledgers and receipts (Flow A) | **5 years**; confirm the tax requirement with an accountant (OQ-16) | Keep, with student and teacher identity anonymized where possible | Kept. Anonymized accounts already show no name. |
| Flow B ledger | 5 years by default; the teacher is the controller (confirm) | Anonymize the student link after the account is anonymized | Kept; the account's anonymization removes the identity. |
| Workspace content (videos, PDFs) | While the workspace is active; **90 days after cancellation** (after the export window) | Delete, including originals | Not yet: no "cancelled workspace" state. |
| Audit logs | 5 years, with personal data reduced to IDs (SEC-11) | Delete | **Enforced**: monthly partitions older than 5 years are dropped (`app.purge_expired_log_rows`). |
| Consent records | Life of the account + 5 years (evidence of consent) | Delete | Kept (the anonymization date isn't stored yet, so the 5 years can't be counted). |
| Application logs | **30 days** | Delete | Outside the database: the log platform's setting (paid setup). |
| Security logs (logins, OTP, support sessions) | 12 months | Delete | **Enforced**: sessions, revoked devices, one-time codes and support sessions older than 12 months. |
| Notifications, attempt activity events | 12 months | Delete | **Enforced**: notification partitions older than 12 months are dropped. |
| Backups | 30 days | Expire. The privacy policy says deleted data can remain in backups for up to 30 days | Paid setup (REQ-OPS-001). |

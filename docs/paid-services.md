# Paid services: deferred until customers pay

The current goal is a **sales demo** that runs entirely on free services. This file lists every part of the product that needs a paid service, what the demo uses instead, and what has to be done when the time comes. The code already routes each of these through an adapter, so switching is configuration plus one new adapter class (REQ-OPS-006).

| Area | Paid service (planned) | What the demo uses instead | Work needed to switch | Tracked in |
|---|---|---|---|---|
| **Phone codes (OTP)** | WhatsApp Business authentication messages, with an SMS provider as fallback | `OTP_PROVIDER=console` (the code appears in the server log) or `file` (the code is written to a file). Seeded demo accounts are already verified | Write `WhatsAppOtpSender` (and an SMS sender) implementing `OtpSender`; Meta business verification and an approved template. Production refuses the demo senders | OQ-19, REQ-AUTH-001 |
| **Email** | Resend (or another HTTP email provider) with a verified domain | `EMAIL_PROVIDER=none` on the demo. Locally, SMTP to Mailpit (free) | Write `ResendEmailSender` implementing `EmailSender`; buy a domain and verify it. The email-address confirmation flow is built with it, since the demo sends no email | OQ-20, review §3.19 |
| **Video delivery** | Bunny Stream (transcoding, CDN, token auth) | The free `self-hls` adapter (ffmpeg on a developer machine, files in free object storage) when video is built in Phase 5 | Write the `bunny` adapter implementing `VideoProvider` | SCALE-01, REQ-VIDEO-005, OQ-17 |
| **Hosting with backups** | Setup C: DigitalOcean managed Postgres with point-in-time recovery, containers, off-site backups (about $55–110/month) | Setup A: Render Free and Neon Free, synthetic data only (`docs/deploy-demo.md`) | Follow architecture §8.3; add the backup job and alerts (REQ-OPS-001, REQ-OPS-002) | OQ-18, REQ-OPS-005 |
| **Error tracking seats** | Sentry Team (for more than one person) | No error tracking on the demo, or Sentry's free plan for one person | Configuration only | architecture §8 |
| **Domain name** | About $10 a year | The hosting provider's subdomains | DNS and configuration | OQ-20 |
| **External penetration test** | A freelance tester before general launch | The automated cross-tenant suite and the security checks in CI | Book the test before real data | REQ-SEC-002 |
| **Legal and accounting advice** | Lawyer and accountant | Deferred (OD-08) | See open-questions.md | OQ-11 to OQ-16 |
| **File storage and a separate file origin** | S3-compatible object storage (Cloudflare R2) and a cookieless file domain (for example `files.<domain>`) | `STORAGE_PROVIDER=local` (files on the API server's disk under `STORAGE_DIR`), served by the API with `nosniff`, a sandbox policy and `attachment` for non-images | Write an S3 `FileStorage` adapter; buy the domain and serve files there; move the scan job's image re-encoding in with an image library (a new dependency) | REQ-FILE-001 |

## Rules while the product is a demo

- Only synthetic data (REQ-OPS-005, REQ-PRIV-006): the API refuses to start with real data on any tier other than production.
- Demo accounts use the phone block `0100000xxxx` (`pnpm --filter @lms/api db:seed`).
- Everything that is free is built properly, with tests. Nothing in the demo is a mock except the senders listed above, and they are clearly labelled development senders.

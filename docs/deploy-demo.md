# Runbook: free demo deployment (setup A)

This deploys the demo described in [architecture.md §8.1](architecture.md). It costs nothing, sleeps when idle, and holds **synthetic data only**. The API refuses to start on the `demo` tier with `DATA_CLASS=real`.

The platform owners do these steps. They need accounts at Render and Neon, and access to this repository on GitHub.

## 0. Before you start

- [ ] Check the free-tier terms and limits for Render and Neon (open question OQ-18). Free tiers change, and some forbid commercial use.
- [ ] Have a password manager ready: you'll store database passwords, the encryption key and the demo logins.

## 1. Database (Neon)

1. Create a Neon project in the **EU (Frankfurt)** region, database `lms`.
2. Copy the connection string of the owner role Neon created. This is the **migrator**. Use the direct (not pooled) connection string.
3. From your machine, apply the migrations and install the job queue:

   ```bash
   DATABASE_MIGRATOR_URL='postgres://…owner…@…/lms?sslmode=require' pnpm --filter @lms/api db:migrate
   ```

4. In Neon's SQL editor, create the two application users, each with its own strong password, and give each exactly one group:

   ```sql
   CREATE ROLE lms_app LOGIN PASSWORD '…';
   GRANT app_runtime TO lms_app;
   CREATE ROLE lms_platform LOGIN PASSWORD '…';
   GRANT app_platform TO lms_platform;
   ```

   The API checks this at startup. It refuses to run as a superuser, as a role that bypasses row-level security, or as a user in the wrong group.

## 2. Encryption key

Generate a key for this environment only (never reuse the local or test one):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## 3. Demo data

```bash
DEPLOY_TIER=demo DATA_CLASS=synthetic \
DATABASE_URL='postgres://lms_app:…@…/lms?sslmode=require' \
DATABASE_PLATFORM_URL='postgres://lms_platform:…@…/lms?sslmode=require' \
WEB_ORIGINS=https://example.invalid \
SECRET_ENCRYPTION_KEY='…the key from step 2…' \
DEMO_PASSWORD='…choose one…' \
pnpm --filter @lms/api db:seed
```

It prints every demo login, and an authenticator key for each account that needs two-step verification (platform owner, teachers, class teacher). Add those keys to an authenticator app and keep the output in the password manager.

## 4. Render

1. In Render, choose **New → Blueprint** and select this repository. Render reads `render.yaml` and proposes two services, `lms-api` and `lms-web`.
2. Enter the values marked "sync: false":
   - `lms-api`: `DATABASE_URL`, `DATABASE_PLATFORM_URL` (the `lms_app` and `lms_platform` connection strings), `SECRET_ENCRYPTION_KEY` (step 2), `WEB_ORIGINS` (the web service URL, for example `https://lms-web.onrender.com`).
   - `lms-web`: `API_ORIGIN` (the API service URL, for example `https://lms-api.onrender.com`).
3. Deploy. If you set `API_ORIGIN` after the first build, redeploy `lms-web`: it's used at build time.

## 5. Check it works

- [ ] `https://<api>/api/health` answers `{"status":"ok"}`. The first request after idling can take up to a minute.
- [ ] `https://<web>/` opens in Arabic, right to left.
- [ ] Sign in as the seeded helper (`01000000005`, demo password). The account page shows the devices list.
- [ ] Sign in as the physics teacher (`01000000002`), enter the authenticator code, and see the account page.
- [ ] **Client IP check** (rate limits depend on it): sign in once, then in Neon run `select personal_context->>'ip' from audit_log where action = 'auth.login' order by occurred_at desc limit 1;`. It should be your own public IP.
  - If it's a Render address, increase `TRUST_PROXY_HOPS` by one.
  - If it's something you could have typed yourself, decrease it.
- [ ] New registrations: the OTP appears in `lms-api`'s log stream in Render (demo only).

## 6. Known limits of the free setup

See [architecture.md §8.2](architecture.md): services sleep, there are no backups, storage is small, and email is off. **Never put a real teacher's or student's data here.** Moving to real data means setup C ([architecture.md §8.3](architecture.md)).

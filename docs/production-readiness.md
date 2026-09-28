# Production Readiness

## Backend configuration

The API uses environment-specific configuration:

- Development uses SQLite and applies migrations automatically.
- Production uses PostgreSQL when `Database:Provider` is `PostgreSql`.
- Production migrations should be applied by the release pipeline, not at application startup.
- `Jwt:Secret` must be supplied as a deployment secret. Do not commit it to source control.
- `Cors:AllowedOrigins` must contain the exact deployed frontend origins.

Equivalent environment variables use double underscores, for example:

```text
ConnectionStrings__DefaultConnection=Host=...;Database=...;Username=...;Password=...
Database__Provider=PostgreSql
Database__ApplyMigrations=false
Jwt__Secret=<long-random-secret>
Cors__AllowedOrigins__0=https://app.example.com
```

## Local development

Run the API from `EducationPlatform.Api` with the Development environment and run the frontend from `web`.

The seeded development accounts are:

- `admin@edu.com` / `admin123`
- `teacher@edu.com` / `teacher123`
- `student@edu.com` / `student123`

These credentials are for local development only and must be replaced before any shared deployment.

Set `NEXT_PUBLIC_API_URL` for the frontend, for example:

```text
NEXT_PUBLIC_API_URL=https://localhost:5001
```

## Release gates still required

Before calling the platform production-ready, complete the following release work:

- Replace development password hashing with ASP.NET Core Identity or Argon2id/bcrypt and add refresh-token/session revocation.
- Add PostgreSQL migrations and run them in CI/CD against staging before production.
- Configure TLS termination, secure cookies where applicable, secret management, backups, restore drills, and centralized logs.
- Add object storage with private signed URLs, malware scanning, video transcoding, and backend authorization for every media request.
- Add password reset, email verification, account lockout, 2FA, and login audit events.
- Add integration/security tests for IDOR, role boundaries, payment approvals, enrollment rules, and protected content.
- Add background jobs for reports, notifications, video processing, and exports.
- Add monitoring, alerting, health checks for database/storage dependencies, and rollback procedures.
- Complete the remaining academic modules: course authoring, homework, exams, attendance, grades, payments, subscriptions, notifications, reports, and parent read-only access.

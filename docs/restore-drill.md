# Restore drill

REQ-OPS-001 asks for point-in-time recovery, nightly encrypted off-site dumps, a monthly automated
restore test and a quarterly manual drill once real data is stored (the paid setup, C). The free
setups hold synthetic data only and have no backup requirement. This drill practises the restore
half locally, so the steps and their timing are known before setup C.

## Running it

With the local containers up (`docker compose up -d`):

```bash
bash scripts/restore-drill.sh
```

It dumps `lms_dev` from the `lms-postgres-1` container (`pg_dump -Fc`), restores it into a scratch
database (`pg_restore --exit-on-error`), compares the row counts of the tables that matter (users,
memberships, classes and enrolments, grades and their history, payments, exam attempts and
answers, homework submissions, files, the audit log and notifications), prints the times, and
drops the scratch database. It exits non-zero on any mismatch.

On Windows, run it from Git Bash; the script turns off Git Bash's path rewriting
(`MSYS_NO_PATHCONV=1`), which would otherwise turn the container's `/tmp/...` into a Windows path.

## Last run

2026-09-30, developer laptop, the local database after the load tests (about 8,300 synthetic
users, 22,500 audit events): dump 1 s (5.3 MB), restore 3 s, every row count matched. REQ-OPS-001's
target is a restore under 4 hours on production data.

## For setup C

- Restore from the provider's point-in-time recovery and from the off-site dump, not from a dump
  taken moments before.
- Time the whole path: fetching the dump, decrypting it, restoring, and pointing the API at it.
- Check a few records by hand as well as the counts (a recent payment, a released grade).
- Record the date, the duration and any problem here.

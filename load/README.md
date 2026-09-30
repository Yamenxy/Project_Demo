# Load tests

[k6](https://k6.io) profiles for the performance targets in the requirements. They are not part
of `pnpm test`; run them by hand, and before each release that touches assessments.

## Exam start and autosave (REQ-EXAM-005)

Targets: exam start p95 under 500 ms at 200 starts per minute, autosave p95 under 300 ms, and
zero lost acknowledged answers. `exam.js` fails if any of these is missed.

1. Start the API (`pnpm --filter @lms/api start`, with its worker jobs) against the database you
   want to measure. Only synthetic, non-production tiers are allowed.
2. Prepare a fixture: a new workspace with an open exam and enough students (each student starts
   once, so use at least rate × minutes):

   ```bash
   pnpm --filter @lms/api load:seed -- --students 700 --out ../../load/fixture.json
   ```

3. Run the profile:

   ```bash
   k6 run -e FIXTURE=./fixture.json -e RATE=200 -e MINUTES=3 load/exam.js
   ```

   For the year-three target, use `RATE=1500` and a fixture with at least 4,500 students (the
   seed allows 5,000).

The fixture file holds session tokens for the synthetic students; it's ignored by git and the
sessions expire after a day.

**What counts:** the requirement asks for these numbers on a staging environment sized like
production. A run on a developer laptop, where the API, the database and k6 share one machine,
only shows that the profile works and gives a rough baseline; it isn't the acceptance result.

## Latest local run (2026-09-30, developer laptop)

One Windows laptop running the API (one Node process, `WORKER_MODE=inline`, 10 database
connections), PostgreSQL in Docker and k6 together. A baseline, not the acceptance run.

| Rate                      | Starts | Saves  | Start p95 | Autosave p95 | Failed requests | Lost acknowledged answers |
| ------------------------- | ------ | ------ | --------- | ------------ | --------------- | ------------------------- |
| 200 a minute, 3 minutes   | 601    | 5,409  | 18 ms     | 12.6 ms      | 0               | 0                         |
| 1,500 a minute, 3 minutes | 4,117  | 37,053 | 1.15 s    | 1.14 s       | 0               | 0                         |

At 200 a minute every target passes with a wide margin. At the year-three rate nothing failed
and no answer was lost, but both p95 targets were missed and k6 dropped 384 starts at its 400-VU
cap: the single process saturated at about 250 requests a second. Things to measure on staging
before tuning: more API processes, a bigger pool (`DATABASE_POOL_MAX`), a separate worker process,
and the session lookup, which writes `last_seen_at` on every request.

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

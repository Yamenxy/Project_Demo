// Exam load profile (REQ-EXAM-005). Run with k6 against a fixture from `load:seed`; see README.md.
//
//   k6 run -e FIXTURE=./fixture.json -e RATE=200 -e MINUTES=3 load/exam.js
//
// Each iteration is one student: start the attempt, answer the three questions a few times
// (autosave), then read the paper back and check that every acknowledged answer is there.
import exec from 'k6/execution';
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

const fixture = JSON.parse(open(__ENV.FIXTURE || './fixture.json'));
const rate = Number(__ENV.RATE || 200);
const minutes = Number(__ENV.MINUTES || 3);

const lostAnswers = new Counter('lost_acknowledged_answers');
const noStudentLeft = new Counter('students_exhausted');

export const options = {
  scenarios: {
    exam_start: {
      executor: 'constant-arrival-rate',
      rate,
      timeUnit: '1m',
      duration: `${minutes}m`,
      preAllocatedVUs: 50,
      maxVUs: 400,
    },
  },
  thresholds: {
    'http_req_duration{name:start}': ['p(95)<500'],
    'http_req_duration{name:save}': ['p(95)<300'],
    lost_acknowledged_answers: ['count==0'],
    http_req_failed: ['rate<0.01'],
    students_exhausted: ['count==0'],
  },
};

const base = `${fixture.api}/api/v1/w/${fixture.workspaceId}`;

function params(token, name) {
  return {
    headers: { 'content-type': 'application/json', cookie: `lms_session=${token}` },
    tags: { name },
  };
}

export default function () {
  const n = exec.scenario.iterationInTest;
  const token = fixture.tokens[n];
  if (!token) {
    noStudentLeft.add(1);
    return;
  }
  const started = http.post(
    `${base}/my/exams/${fixture.examId}/attempts`,
    null,
    params(token, 'start'),
  );
  if (!check(started, { started: (r) => r.status === 201 || r.status === 200 })) return;
  const attemptId = started.json('attemptId');

  const paper = http.get(`${base}/my/attempts/${attemptId}`, params(token, 'paper')).json();
  const responses = paper.questions.map((q) => {
    if (q.kind === 'mcq') return q.choices.map((c) => ({ choiceId: c.id }));
    if (q.kind === 'true_false') return [{ value: true }, { value: false }];
    return [{ text: 'القاهرة' }, { text: 'الجيزة' }];
  });

  // Acknowledged seq per position: what the server promised to keep.
  const acked = {};
  let seq = 0;
  for (let round = 0; round < 3; round++) {
    paper.questions.forEach((q, i) => {
      seq += 1;
      const options = responses[i];
      const body = JSON.stringify({ response: options[(round + i) % options.length], seq });
      const saved = http.put(
        `${base}/my/attempts/${attemptId}/answers/${q.position}`,
        body,
        params(token, 'save'),
      );
      if (check(saved, { saved: (r) => r.status === 200 })) acked[q.position] = seq;
    });
    sleep(1);
  }

  const after = http.get(`${base}/my/attempts/${attemptId}`, params(token, 'paper')).json();
  for (const [position, ackedSeq] of Object.entries(acked)) {
    const kept = after.answers[position];
    if (!kept || kept.seq < ackedSeq) lostAnswers.add(1);
  }
  http.post(`${base}/my/attempts/${attemptId}/submit`, null, params(token, 'submit'));
}

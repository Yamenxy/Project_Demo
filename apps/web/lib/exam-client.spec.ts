import { describe, expect, it } from 'vitest';
import { acknowledge, clockOffset, enqueueAnswer, nextSeq, remainingMs } from './exam-client';

describe('exam client (REQ-EXAM-004)', () => {
  it('follows the server clock, so a wrong device clock changes nothing', () => {
    const server = '2026-10-01T10:00:00.000Z';
    const serverMs = Date.parse(server);
    // The device clock is 2 hours behind; the request took 200 ms.
    const deviceSent = serverMs - 7_200_000 - 100;
    const offset = clockOffset(server, deviceSent, deviceSent + 200);
    const deadline = '2026-10-01T10:30:00.000Z';
    expect(remainingMs(deadline, offset, deviceSent + 100)).toBe(30 * 60_000);
    expect(remainingMs(deadline, offset, deviceSent + 100 + 31 * 60_000)).toBe(0);
  });

  it('sequence numbers only move forward, even if the clock goes back', () => {
    expect(nextSeq(0, 1000)).toBe(1000);
    expect(nextSeq(1000, 500)).toBe(1001);
    expect(nextSeq(1001, 5000)).toBe(5000);
  });

  it('keeps the newest answer per question until the server acknowledges it', () => {
    let queue = enqueueAnswer([], { position: 0, response: { value: true }, seq: 1 });
    queue = enqueueAnswer(queue, { position: 1, response: { text: 'x' }, seq: 2 });
    queue = enqueueAnswer(queue, { position: 0, response: { value: false }, seq: 3 });
    expect(queue.map((p) => [p.position, p.seq])).toEqual([
      [1, 2],
      [0, 3],
    ]);
    // An acknowledgement for an older save doesn't drop the newer answer.
    expect(acknowledge(queue, 0, 1).map((p) => p.seq)).toEqual([2, 3]);
    expect(acknowledge(queue, 0, 3).map((p) => p.seq)).toEqual([2]);
  });
});

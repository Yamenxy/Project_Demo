import { describe, expect, it } from 'vitest';
import {
  classify,
  codeFrom,
  dequeue,
  enqueue,
  qrText,
  ScanStore,
  type CachedRoster,
  type QueuedScan,
} from './scan';

const roster: CachedRoster = {
  sessionId: 's1',
  students: [
    { membershipId: 'm1', name: 'مريم', platformCode: 'ABCD2345', paused: false },
    { membershipId: 'm2', name: 'عمر', platformCode: 'EFGH6789', paused: true },
  ],
  others: [{ membershipId: 'm3', name: 'نور', platformCode: 'JKLM2345', paused: false }],
};

describe('QR attendance rules (REQ-ATT-001)', () => {
  it('reads the QR text or a typed code', () => {
    expect(codeFrom(qrText('ABCD2345'))).toBe('ABCD2345');
    expect(codeFrom(' abcd 2345 ')).toBe('ABCD2345');
    expect(codeFrom('LMS:abcd2345')).toBe('ABCD2345');
  });

  it('green for the class, amber for paused or another class, red for unknown', () => {
    expect(classify('lms:ABCD2345', roster).kind).toBe('ok');
    expect(classify('EFGH6789', roster).kind).toBe('paused');
    expect(classify('JKLM2345', roster).kind).toBe('not_in_class');
    expect(classify('ZZZZ2222', roster)).toEqual({ kind: 'unknown', code: 'ZZZZ2222' });
  });

  it('queues each student once and drops what the server confirmed', () => {
    const a: QueuedScan = { membershipId: 'm1', takenAt: '2026-10-03T14:00:00Z' };
    const b: QueuedScan = { membershipId: 'm3', takenAt: '2026-10-03T14:01:00Z' };
    let queue = enqueue([], a);
    queue = enqueue(queue, { ...a, takenAt: '2026-10-03T14:05:00Z' });
    queue = enqueue(queue, b);
    expect(queue).toEqual([a, b]);
    expect(dequeue(queue, [a])).toEqual([b]);
  });

  it('keeps the roster and queue in storage, and survives broken storage', () => {
    const data = new Map<string, string>();
    const store = new ScanStore('s1', {
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => data.set(k, v),
    });
    store.saveRoster(roster);
    store.saveQueue([{ membershipId: 'm1', takenAt: 'x' }]);
    const again = new ScanStore('s1', {
      getItem: (k) => data.get(k) ?? null,
      setItem: () => undefined,
    });
    expect(again.roster()).toEqual(roster);
    expect(again.queue()).toHaveLength(1);
    const broken = new ScanStore('s1', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(broken.queue()).toEqual([]);
    expect(() => broken.saveQueue([])).not.toThrow();
  });
});

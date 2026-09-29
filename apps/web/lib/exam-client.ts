/**
 * The exam client's rules (REQ-EXAM-004): answers wait in a local queue until the server
 * acknowledges them, each with a sequence number that only moves forward; the timer follows the
 * server's deadline corrected for the device clock's offset, so changing the device clock has no
 * effect.
 */

export type Response = { choiceId: string } | { value: boolean } | { text: string };

export interface Pending {
  position: number;
  response: Response;
  seq: number;
}

/** Server time minus device time, measured around one request. */
export function clockOffset(serverNowIso: string, sentAt: number, receivedAt: number): number {
  return Date.parse(serverNowIso) - (sentAt + receivedAt) / 2;
}

/** Milliseconds left by the server's clock, never negative. */
export function remainingMs(deadlineIso: string, offset: number, deviceNow: number): number {
  return Math.max(0, Date.parse(deadlineIso) - (deviceNow + offset));
}

/** The next sequence number: larger than every one used before, whatever the clock says. */
export function nextSeq(lastSeq: number, deviceNow: number): number {
  return Math.max(lastSeq + 1, deviceNow);
}

/** The newest answer per question replaces an older one waiting in the queue. */
export function enqueueAnswer(queue: Pending[], item: Pending): Pending[] {
  return [...queue.filter((p) => p.position !== item.position), item];
}

/** Drops what the server acknowledged (a newer answer for the same question stays). */
export function acknowledge(queue: Pending[], position: number, seq: number): Pending[] {
  return queue.filter((p) => !(p.position === position && p.seq <= seq));
}

interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Queue and last sequence number kept on the device, per attempt. */
export class AnswerStore {
  constructor(
    private readonly attemptId: string,
    private readonly store: KeyValueStore | null,
  ) {}

  private read<T>(key: string, fallback: T): T {
    try {
      const raw = this.store?.getItem(key);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  }

  private write(key: string, value: unknown): void {
    try {
      this.store?.setItem(key, JSON.stringify(value));
    } catch {
      // Storage unavailable: the in-memory queue still works while the page is open.
    }
  }

  queue(): Pending[] {
    return this.read<Pending[]>(`lms.exam.${this.attemptId}.queue`, []);
  }

  saveQueue(queue: Pending[]): void {
    this.write(`lms.exam.${this.attemptId}.queue`, queue);
  }

  lastSeq(): number {
    return this.read<number>(`lms.exam.${this.attemptId}.seq`, 0);
  }

  saveLastSeq(seq: number): void {
    this.write(`lms.exam.${this.attemptId}.seq`, seq);
  }
}

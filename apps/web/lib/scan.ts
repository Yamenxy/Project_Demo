/**
 * Offline QR attendance (REQ-ATT-001): classify a scanned code against the cached roster, and
 * keep scans in a queue that survives until the server has them. Pure functions plus a small
 * storage wrapper, so the rules are unit-tested.
 */

export interface ScanStudent {
  membershipId: string;
  name: string;
  platformCode: string | null;
  paused: boolean;
}

export interface CachedRoster {
  sessionId: string;
  students: ScanStudent[];
  others: ScanStudent[];
}

/**
 * - `ok` (green): in the class and not paused.
 * - `paused` (amber): in the class, but their access is paused.
 * - `not_in_class` (amber): a student of the workspace outside this class.
 * - `unknown` (red): no student has this code.
 */
export type ScanResult =
  | { kind: 'ok' | 'paused' | 'not_in_class'; student: ScanStudent }
  | { kind: 'unknown'; code: string };

export interface QueuedScan {
  membershipId: string;
  takenAt: string;
}

/** The text in a student's QR code. The prefix keeps other QR codes from matching. */
export const QR_PREFIX = 'lms:';

export function qrText(platformCode: string): string {
  return `${QR_PREFIX}${platformCode}`;
}

/** Accepts `lms:CODE` from the camera, or the code typed by hand (any case, with spaces). */
export function codeFrom(raw: string): string {
  const text = raw.trim();
  const code = text.toLowerCase().startsWith(QR_PREFIX) ? text.slice(QR_PREFIX.length) : text;
  return code.replace(/\s+/g, '').toUpperCase();
}

export function classify(raw: string, roster: CachedRoster): ScanResult {
  const code = codeFrom(raw);
  const inClass = roster.students.find((s) => s.platformCode === code);
  if (inClass) return { kind: inClass.paused ? 'paused' : 'ok', student: inClass };
  const other = roster.others.find((s) => s.platformCode === code);
  if (other) return { kind: 'not_in_class', student: other };
  return { kind: 'unknown', code };
}

/** Adds a scan unless the student is already waiting to upload (the first scan time is kept). */
export function enqueue(queue: QueuedScan[], scan: QueuedScan): QueuedScan[] {
  return queue.some((q) => q.membershipId === scan.membershipId) ? queue : [...queue, scan];
}

/** Removes the scans the server confirmed. */
export function dequeue(queue: QueuedScan[], sent: QueuedScan[]): QueuedScan[] {
  const done = new Set(sent.map((s) => s.membershipId));
  return queue.filter((q) => !done.has(q.membershipId));
}

interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Roster and queue kept in the browser, so a lost connection loses nothing. */
export class ScanStore {
  constructor(
    private readonly sessionId: string,
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
      // Storage full or blocked: the in-memory copy still works until the page closes.
    }
  }

  roster(): CachedRoster | null {
    return this.read<CachedRoster | null>(`lms.roster.${this.sessionId}`, null);
  }

  saveRoster(roster: CachedRoster): void {
    this.write(`lms.roster.${this.sessionId}`, roster);
  }

  queue(): QueuedScan[] {
    return this.read<QueuedScan[]>(`lms.scans.${this.sessionId}`, []);
  }

  saveQueue(queue: QueuedScan[]): void {
    this.write(`lms.scans.${this.sessionId}`, queue);
  }
}

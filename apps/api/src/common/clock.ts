/**
 * The only source of "now" in services. Time-dependent rules (exam deadlines, the 48-hour
 * attendance window, grace periods) take it by injection so tests can control time
 * (review TEST-03).
 */
export abstract class Clock {
  abstract now(): Date;
}

export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}

/** A clock that only moves when told to. For tests. */
export class FixedClock extends Clock {
  private current: number;

  constructor(start: Date | string) {
    super();
    this.current = new Date(start).getTime();
  }

  now(): Date {
    return new Date(this.current);
  }

  set(to: Date | string): void {
    this.current = new Date(to).getTime();
  }

  advance(ms: number): void {
    this.current += ms;
  }
}

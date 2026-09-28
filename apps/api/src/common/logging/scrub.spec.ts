import { describe, expect, it } from 'vitest';
import { scrub, scrubString } from './scrub';

describe('scrub', () => {
  it('redacts sensitive keys at any depth and in any spelling', () => {
    const out = scrub({
      userId: 'u1',
      password: 'hunter2',
      nested: {
        guardian_phone: '01012345678',
        'Session-Token': 'abc',
        deeper: [{ OTP: '123456' }],
      },
    });
    expect(out).toEqual({
      userId: 'u1',
      password: '[redacted]',
      nested: {
        guardian_phone: '[redacted]',
        'Session-Token': '[redacted]',
        deeper: [{ OTP: '[redacted]' }],
      },
    });
  });

  it('masks phone numbers and emails inside free text', () => {
    expect(scrubString('call +201012345678 or 01112345678 / mail ali@example.com')).toBe(
      'call [phone] or [phone] / mail [email]',
    );
  });

  it('keeps ids, numbers and ordinary text', () => {
    const input = { workspaceId: '0192f0c4-1c2b-7a3e-9d4f-123456789abc', count: 3, ok: true };
    expect(scrub(input)).toEqual(input);
  });

  it('scrubs error messages but keeps the stack', () => {
    const err = new Error('duplicate phone 01012345678');
    const out = scrub(err) as { message: string; stack?: string };
    expect(out.message).toBe('duplicate phone [phone]');
    expect(out.stack).toBeDefined();
  });

  it('stops at a maximum depth instead of recursing forever', () => {
    const deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let i = 0; i < 20; i++) {
      const next: Record<string, unknown> = {};
      cursor.child = next;
      cursor = next;
    }
    expect(JSON.stringify(scrub(deep))).toContain('[truncated]');
  });
});

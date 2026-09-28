import { describe, expect, it } from 'vitest';
import { base32Encode, matchTotp, otpauthUri, stepAt, totpForStep } from './totp';

// RFC 6238 appendix B, SHA-1 secret "12345678901234567890". The RFC lists 8-digit codes; the
// 6-digit codes are their last six digits.
const RFC_SECRET = Buffer.from('12345678901234567890');

describe('TOTP (RFC 6238 test vectors)', () => {
  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
    [20000000000, '353130'],
  ])('at %i seconds → %s', (seconds, code) => {
    expect(totpForStep(RFC_SECRET, stepAt(seconds * 1000))).toBe(code);
  });
});

describe('matchTotp', () => {
  const now = 1_790_000_000_000;
  const current = stepAt(now);

  it('accepts the current, previous and next step', () => {
    for (const step of [current - 1, current, current + 1]) {
      expect(matchTotp(RFC_SECRET, totpForStep(RFC_SECRET, step), now, null)).toBe(step);
    }
  });

  it('refuses codes outside the window, malformed codes and replays', () => {
    expect(matchTotp(RFC_SECRET, totpForStep(RFC_SECRET, current - 2), now, null)).toBeNull();
    expect(matchTotp(RFC_SECRET, '12345', now, null)).toBeNull();
    expect(matchTotp(RFC_SECRET, totpForStep(RFC_SECRET, current), now, current)).toBeNull();
  });
});

describe('encoding', () => {
  it('encodes base32 per RFC 4648', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Encode(Buffer.from('f'))).toBe('MY');
  });

  it('builds an otpauth URI for authenticator apps', () => {
    const uri = otpauthUri('JBSWY3DPEHPK3PXP', 'A7K2M9QX', 'LMS');
    expect(uri).toBe(
      'otpauth://totp/LMS%3AA7K2M9QX?secret=JBSWY3DPEHPK3PXP&issuer=LMS&algorithm=SHA1&digits=6&period=30',
    );
  });
});

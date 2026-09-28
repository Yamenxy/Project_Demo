import { hash, verify } from '@node-rs/argon2';

/**
 * Password hashing and policy.
 *
 * argon2id with the library defaults (m=19 MiB, t=2, p=1), which match OWASP's recommendation.
 * Policy follows NIST SP 800-63B: length over composition rules, plus a block on very common
 * passwords and on the account's own phone number.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export type PasswordProblem =
  'password_too_short' | 'password_too_long' | 'password_too_common' | 'password_matches_phone';

// Common choices in this market as well as globally. Compared case-insensitively.
const COMMON_PASSWORDS = new Set([
  '12345678',
  '123456789',
  '1234567890',
  '0123456789',
  '11111111',
  '00000000',
  '12341234',
  '87654321',
  '88888888',
  '66666666',
  '55555555',
  'password',
  'password1',
  'qwertyui',
  'qwerty123',
  'iloveyou',
  'abcd1234',
  'aa123456',
  'a1234567',
  '1q2w3e4r',
  'egypt123',
  'misr1234',
  'mohamed1',
  'ahmed123',
  'mahmoud1',
  'bismillah',
]);

export function checkPassword(password: string, phoneE164?: string): PasswordProblem | null {
  if (password.length < PASSWORD_MIN_LENGTH) return 'password_too_short';
  if (password.length > PASSWORD_MAX_LENGTH) return 'password_too_long';
  if (COMMON_PASSWORDS.has(password.toLowerCase())) return 'password_too_common';
  if (/^(.)\1+$/.test(password)) return 'password_too_common';
  if (phoneE164) {
    const national = phoneE164.startsWith('+20') ? `0${phoneE164.slice(3)}` : phoneE164.slice(1);
    const digits = password.replace(/\D/g, '');
    if (digits === phoneE164.slice(1) || digits === national) return 'password_matches_phone';
  }
  return null;
}

export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return verify(passwordHash, password);
}

let dummyHash: Promise<string> | undefined;

/**
 * Runs a verification against a throwaway hash, so a login for an unknown account takes as long
 * as one for a known account (prevents finding registered numbers by timing).
 */
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hash('dummy-password-for-timing');
  await verify(await dummyHash, password);
  return false;
}

import { describe, expect, it } from 'vitest';
import { checkPassword, hashPassword, verifyAgainstDummy, verifyPassword } from './password';

describe('checkPassword', () => {
  it('accepts a reasonable password', () => {
    expect(checkPassword('نجمة-الصباح-7', '+201012345678')).toBeNull();
    expect(checkPassword('correct horse battery')).toBeNull();
  });

  it.each([
    ['short', 'password_too_short'],
    ['x'.repeat(129), 'password_too_long'],
    ['12345678', 'password_too_common'],
    ['PASSWORD', 'password_too_common'],
    ['zzzzzzzzzz', 'password_too_common'],
  ])('rejects %s', (password, problem) => {
    expect(checkPassword(password)).toBe(problem);
  });

  it('rejects the account phone number in national or international form', () => {
    expect(checkPassword('01012345678', '+201012345678')).toBe('password_matches_phone');
    expect(checkPassword('201012345678', '+201012345678')).toBe('password_matches_phone');
    expect(checkPassword('010-1234-5678', '+201012345678')).toBe('password_matches_phone');
  });
});

describe('hashing', () => {
  it('produces argon2id hashes that verify only the right password', async () => {
    const hashed = await hashPassword('correct horse battery');
    expect(hashed.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(hashed, 'correct horse battery')).toBe(true);
    expect(await verifyPassword(hashed, 'wrong horse battery')).toBe(false);
  });

  it('never accepts the dummy verification', async () => {
    expect(await verifyAgainstDummy('dummy-password-for-timing')).toBe(false);
  });
});

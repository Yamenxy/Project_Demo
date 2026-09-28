import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SecretBox } from './secret-box';

const key = randomBytes(32).toString('base64');

describe('SecretBox', () => {
  it('round-trips a secret and never stores it in clear', () => {
    const box = new SecretBox(key);
    const secret = Buffer.from('totp-secret-bytes');
    const sealed = box.seal(secret);
    expect(sealed.startsWith('v1.')).toBe(true);
    expect(sealed).not.toContain(secret.toString('base64url'));
    expect(box.open(sealed).equals(secret)).toBe(true);
  });

  it('uses a fresh IV each time', () => {
    const box = new SecretBox(key);
    expect(box.seal(Buffer.from('x'))).not.toBe(box.seal(Buffer.from('x')));
  });

  it('rejects tampering and the wrong key', () => {
    const box = new SecretBox(key);
    const sealed = box.seal(Buffer.from('secret'));
    const parts = sealed.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => box.open(parts.join('.'))).toThrow();
    expect(() => new SecretBox(randomBytes(32).toString('base64')).open(sealed)).toThrow();
  });

  it('requires a 32-byte key', () => {
    expect(() => new SecretBox(randomBytes(16).toString('base64'))).toThrow('32 bytes');
  });
});

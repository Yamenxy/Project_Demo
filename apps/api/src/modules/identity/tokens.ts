import { createHash, randomBytes, randomInt } from 'node:crypto';

/** 256-bit random token for the session cookie. Only its hash is stored. */
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// No 0/O, 1/I: codes are read aloud and typed by staff at the centre.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** 8-character platform student code (about 40 bits). Uniqueness is enforced by the database. */
export function generatePlatformCode(): string {
  let code = '';
  for (let i = 0; i < 8; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

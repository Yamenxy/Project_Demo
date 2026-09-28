import { createHmac, randomInt } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { OTP_OUTBOX } from '../playwright.config';

export function randomPhone(): string {
  return `010${String(randomInt(10_000_000, 99_999_999))}`;
}

/** The latest code the API's development `file` sender wrote for this phone and purpose. */
export async function latestOtp(localPhone: string, purpose: string): Promise<string> {
  const phoneE164 = `+20${localPhone.slice(1)}`;
  for (let attempt = 0; attempt < 50; attempt++) {
    const content = await readFile(OTP_OUTBOX, 'utf8').catch(() => '');
    const match = content
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { phoneE164: string; purpose: string; code: string })
      .filter((entry) => entry.phoneE164 === phoneE164 && entry.purpose === purpose)
      .at(-1);
    if (match) return match.code;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`No ${purpose} code for ${phoneE164}`);
}

/** TOTP (RFC 6238, SHA-1, 30 s, 6 digits) for a base32 secret, as an authenticator app computes it. */
export function totp(secretBase32: string, timeMs = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of secretBase32) {
    value = (value << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(timeMs / 30_000)));
  const hmac = createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0x0f;
  return String((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

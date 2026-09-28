import { randomBytes } from 'node:crypto';

/** Generates primary keys. Injected so tests can use predictable IDs. */
export abstract class IdGenerator {
  abstract newId(): string;
}

/**
 * UUID version 7 (RFC 9562): a 48-bit millisecond timestamp followed by random bits, so IDs sort
 * roughly by creation time. That keeps B-tree index inserts local (architecture §6).
 */
export class UuidV7Generator extends IdGenerator {
  newId(): string {
    return uuidV7(Date.now());
  }
}

export function uuidV7(timestampMs: number): string {
  const bytes = randomBytes(16);
  let ts = BigInt(timestampMs);
  for (let i = 5; i >= 0; i--) {
    bytes[i] = Number(ts & 0xffn);
    ts >>= 8n;
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70; // version 7
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // RFC 9562 variant
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

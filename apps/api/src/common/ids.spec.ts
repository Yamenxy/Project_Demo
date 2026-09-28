import { describe, expect, it } from 'vitest';
import { isUuid } from '../database/types';
import { UuidV7Generator, uuidV7 } from './ids';

describe('uuidV7', () => {
  it('produces a valid version 7 UUID with the RFC 9562 variant', () => {
    const id = new UuidV7Generator().newId();
    expect(isUuid(id)).toBe(true);
    expect(id[14]).toBe('7');
    expect(['8', '9', 'a', 'b']).toContain(id[19]);
  });

  it('encodes the timestamp in the first 48 bits', () => {
    const ts = Date.UTC(2026, 8, 29, 12, 0, 0);
    const id = uuidV7(ts);
    const encoded = parseInt(id.replace(/-/g, '').slice(0, 12), 16);
    expect(encoded).toBe(ts);
  });

  it('sorts by creation time across milliseconds', () => {
    const earlier = uuidV7(1_000_000);
    const later = uuidV7(1_000_001);
    expect(earlier < later).toBe(true);
  });

  it('does not repeat', () => {
    const ids = new Set(Array.from({ length: 10_000 }, () => uuidV7(1_000_000)));
    expect(ids.size).toBe(10_000);
  });
});

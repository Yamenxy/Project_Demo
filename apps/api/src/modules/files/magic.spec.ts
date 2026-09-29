import { describe, expect, it } from 'vitest';
import { sniff } from './magic';

describe('file type by magic bytes (REQ-FILE-001)', () => {
  it('recognises PDF, PNG, JPEG and WebP', () => {
    expect(sniff(Buffer.from('%PDF-1.7 ...'))).toBe('application/pdf');
    expect(sniff(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe(
      'image/png',
    );
    expect(sniff(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0]))).toBe('image/jpeg');
    expect(
      sniff(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')])),
    ).toBe('image/webp');
  });

  it('refuses anything else, whatever its name says', () => {
    expect(sniff(Buffer.from('<html><script>alert(1)</script>'))).toBeNull();
    expect(sniff(Buffer.from('MZ\x90\x00'))).toBeNull();
    expect(sniff(Buffer.alloc(0))).toBeNull();
  });
});

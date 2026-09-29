/**
 * File types accepted for upload, recognised by their first bytes rather than the name or the
 * declared type (REQ-FILE-001).
 */
export type KnownType = 'application/pdf' | 'image/png' | 'image/jpeg' | 'image/webp';

export function sniff(data: Buffer): KnownType | null {
  if (data.length >= 5 && data.subarray(0, 5).toString('latin1') === '%PDF-')
    return 'application/pdf';
  if (
    data.length >= 8 &&
    data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    data.length >= 12 &&
    data.subarray(0, 4).toString('latin1') === 'RIFF' &&
    data.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

export function isImage(type: string): boolean {
  return type.startsWith('image/');
}

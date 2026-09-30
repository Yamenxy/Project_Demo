import { describe, expect, it } from 'vitest';
import { whatsAppLink } from './whatsapp';

describe('whatsAppLink (REQ-NOTIF-002)', () => {
  it('uses the digits of the E.164 number and encodes the Arabic text', () => {
    expect(whatsAppLink('+201012345678', 'السلام عليكم')).toBe(
      'https://wa.me/201012345678?text=%D8%A7%D9%84%D8%B3%D9%84%D8%A7%D9%85%20%D8%B9%D9%84%D9%8A%D9%83%D9%85',
    );
  });

  it('refuses anything that is not an E.164 number', () => {
    expect(whatsAppLink('01012345678', 'x')).toBeNull();
    expect(whatsAppLink('+20 10', 'x')).toBeNull();
    expect(whatsAppLink('', 'x')).toBeNull();
  });
});

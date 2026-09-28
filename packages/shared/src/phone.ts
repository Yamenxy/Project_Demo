/**
 * Phone number normalization (REQ-USER-002, REQ-I18N-001).
 *
 * Accepts what people actually type or paste: Arabic-Indic and Persian digits, spaces, dashes,
 * parentheses, and the Egyptian forms 01XXXXXXXXX, +20 1XXXXXXXXX, 0020 1XXXXXXXXX,
 * 20 1XXXXXXXXX, and 1XXXXXXXXX (Excel drops the leading zero). Other countries are accepted in
 * international form (+ or 00 prefix) for students living abroad. Returns E.164 or null.
 */
const ARABIC_INDIC_ZERO = 0x0660;
const PERSIAN_ZERO = 0x06f0;

/** Converts Arabic-Indic (٠-٩) and Persian (۰-۹) digits to ASCII digits. */
export function toWesternDigits(input: string): string {
  return input.replace(/[٠-٩۰-۹]/g, (ch) => {
    const code = ch.charCodeAt(0);
    const base = code >= PERSIAN_ZERO ? PERSIAN_ZERO : ARABIC_INDIC_ZERO;
    return String(code - base);
  });
}

// Egyptian mobile numbers: 1, then an operator digit (0 Vodafone, 1 e&, 2 Orange, 5 WE), then 8 digits.
const EGYPT_MOBILE = /^1[0125]\d{8}$/;
const INTERNATIONAL = /^[1-9]\d{7,14}$/;

export function normalizePhone(raw: string): string | null {
  const compact = toWesternDigits(raw).replace(/[\s\-().‎‏]/g, '');
  if (!/^\+?\d+$/.test(compact)) return null;

  let digits: string;
  let international: boolean;
  if (compact.startsWith('+')) {
    digits = compact.slice(1);
    international = true;
  } else if (compact.startsWith('00')) {
    digits = compact.slice(2);
    international = true;
  } else {
    digits = compact;
    international = false;
  }

  if (digits.startsWith('20') && EGYPT_MOBILE.test(digits.slice(2))) return `+${digits}`;
  if (!international) {
    if (digits.startsWith('0') && EGYPT_MOBILE.test(digits.slice(1)))
      return `+20${digits.slice(1)}`;
    if (EGYPT_MOBILE.test(digits)) return `+20${digits}`;
    return null;
  }
  // An international number claiming +20 must be a valid Egyptian mobile.
  if (digits.startsWith('20')) return null;
  return INTERNATIONAL.test(digits) ? `+${digits}` : null;
}

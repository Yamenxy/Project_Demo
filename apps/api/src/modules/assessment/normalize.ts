import { toWesternDigits } from '@lms/shared';

/**
 * Short-answer matching (REQ-QBANK-003): digits, whitespace and case always normalised; Arabic
 * letter variants only when the teacher enables them for the question.
 */
export function normalizeAnswer(text: string, options: { arabicVariants: boolean }): string {
  let value = toWesternDigits(text)
    .normalize('NFKC')
    .replace(/[ـ]/g, '') // tatweel
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (options.arabicVariants) {
    value = value
      .replace(/[ً-ٰٟ]/g, '') // tashkeel
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/ؤ/g, 'و')
      .replace(/ئ/g, 'ي');
  }
  return value;
}

export function matchesShortAnswer(
  given: string,
  accepted: string[],
  options: { arabicVariants: boolean },
): boolean {
  const normalized = normalizeAnswer(given, options);
  return normalized !== '' && accepted.some((a) => normalizeAnswer(a, options) === normalized);
}

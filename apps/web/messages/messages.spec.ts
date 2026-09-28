import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import ar from './ar.json';
import en from './en.json';

function keys(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object') return [prefix];
  return Object.entries(value).flatMap(([key, inner]) =>
    keys(inner, prefix ? `${prefix}.${key}` : key),
  );
}

describe('message catalogues', () => {
  it('have the same keys in Arabic and English', () => {
    expect(keys(ar).sort()).toEqual(keys(en).sort());
  });

  it('have no empty messages', () => {
    for (const catalogue of [ar, en]) {
      for (const key of keys(catalogue)) {
        const value = key
          .split('.')
          .reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], catalogue);
        expect(String(value).trim(), key).not.toBe('');
      }
    }
  });

  it('render every Arabic plural category (REQ-I18N-002)', () => {
    const t = createTranslator({ locale: 'ar', messages: ar });
    const render = (count: number) => t('common.studentsCount', { count });
    expect(render(0)).toBe('لا يوجد طلاب');
    expect(render(1)).toBe('طالب واحد');
    expect(render(2)).toBe('طالبان');
    expect(render(3)).toBe('3 طلاب');
    expect(render(11)).toBe('11 طالبًا');
    expect(render(100)).toBe('100 طالب');
  });

  it('render English plurals', () => {
    const t = createTranslator({ locale: 'en', messages: en });
    expect(t('common.studentsCount', { count: 1 })).toBe('1 student');
    expect(t('common.studentsCount', { count: 5 })).toBe('5 students');
  });
});

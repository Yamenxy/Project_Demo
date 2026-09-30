import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from './csv';

describe('CSV (REQ-REPORT-001)', () => {
  it('starts with a byte-order mark and ends lines with CRLF', () => {
    const csv = toCsv(['الاسم', 'الدرجة'], [['منى', 17.5]]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toBe('﻿الاسم,الدرجة\r\nمنى,17.5\r\n');
  });

  it.each([
    ['=HYPERLINK("http://x","click")', `"'=HYPERLINK(""http://x"",""click"")"`],
    ['+201012345678', "'+201012345678"],
    ['-2+3', "'-2+3"],
    ['@SUM(A1)', "'@SUM(A1)"],
    ['\tcmd', "'\tcmd"],
  ])('neutralises the formula-looking %j', (input, output) => {
    expect(csvCell(input)).toBe(output);
  });

  it('quotes commas, quotes and line breaks, and leaves numbers as numbers', () => {
    expect(csvCell('أحمد، علي')).toBe('أحمد، علي'); // the Arabic comma is not a separator
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(csvCell(-150)).toBe('-150');
    expect(csvCell(null)).toBe('');
  });
});

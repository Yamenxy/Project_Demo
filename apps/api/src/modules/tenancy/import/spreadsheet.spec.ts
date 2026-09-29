import { describe, expect, it } from 'vitest';
import { buildXlsx, zip } from '../../../../test/support/xlsx';
import { decodeText, parseCsv, readSpreadsheet, SpreadsheetError } from './spreadsheet';
import { toStudentRows } from './student-rows';

// "الاسم,الموبايل" then "أحمد,01012345678" in Windows-1256.
const WINDOWS_1256 = Buffer.from([
  0xc7, 0xe1, 0xc7, 0xd3, 0xe3, 0x2c, 0xc7, 0xe1, 0xe3, 0xe6, 0xc8, 0xc7, 0xed, 0xe1, 0x0d, 0x0a,
  0xc3, 0xcd, 0xe3, 0xcf, 0x2c, 0x30, 0x31, 0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38,
]);

describe('decodeText (REQ-USER-002)', () => {
  it('reads Windows-1256 files', () => {
    expect(decodeText(WINDOWS_1256)).toBe('الاسم,الموبايل\r\nأحمد,01012345678');
  });

  it('reads UTF-8 with and without a byte-order mark, and UTF-16', () => {
    const text = 'الاسم,الموبايل';
    expect(decodeText(Buffer.from(text, 'utf-8'))).toBe(text);
    expect(decodeText(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text)]))).toBe(
      text,
    );
    expect(
      decodeText(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')])),
    ).toBe(text);
  });
});

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, line breaks in cells and CRLF', () => {
    expect(parseCsv('a,"b, c","say ""hi"""\r\n"line\nbreak",2,3\n')).toEqual([
      ['a', 'b, c', 'say "hi"'],
      ['line\nbreak', '2', '3'],
    ]);
  });

  it('guesses semicolon and tab delimiters', () => {
    expect(parseCsv('name;phone\nمنى;01012345678')).toEqual([
      ['name', 'phone'],
      ['منى', '01012345678'],
    ]);
    expect(parseCsv('name\tphone\nمنى\t01012345678')).toEqual([
      ['name', 'phone'],
      ['منى', '01012345678'],
    ]);
  });
});

describe('readXlsx', () => {
  it('reads shared strings and numbers from the first sheet', () => {
    const file = buildXlsx([
      ['الاسم', 'الموبايل', 'الكود'],
      ['سارة علي', 1012345678, 'A-1'],
      ['<&> ok', '٠١٠١٢٣٤٥٦٧٩', 7],
    ]);
    expect(readSpreadsheet('students.xlsx', file)).toEqual([
      ['الاسم', 'الموبايل', 'الكود'],
      ['سارة علي', '1012345678', 'A-1'],
      ['<&> ok', '٠١٠١٢٣٤٥٦٧٩', '7'],
    ]);
  });

  it('reads inline strings, gaps and numbers in exponent form', () => {
    const sheet =
      '<worksheet><sheetData>' +
      '<row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c><c r="C1" t="inlineStr"><is><t>Phone</t></is></c></row>' +
      '<row r="3"><c r="A3" t="inlineStr"><is><r><t>Omar </t></r><r><t>Adel</t></r></is></c><c r="C3"><v>1.012345678E9</v></c></row>' +
      '</sheetData></worksheet>';
    const file = zip({ 'xl/worksheets/sheet1.xml': sheet });
    expect(readSpreadsheet('x.xlsx', file)).toEqual([
      ['Name', '', 'Phone'],
      [],
      ['Omar Adel', '', '1012345678'],
    ]);
  });

  it('refuses files that are not zips or expand too much', () => {
    expect(() => readSpreadsheet('x.xlsx', Buffer.from('name,phone'))).toThrow(SpreadsheetError);
    const bomb = zip({ 'xl/worksheets/sheet1.xml': 'a'.repeat(25 * 1024 * 1024) });
    expect(() => readSpreadsheet('x.xlsx', bomb)).toThrow(SpreadsheetError);
  });
});

describe('toStudentRows (REQ-USER-002)', () => {
  it('uses Arabic or English headers in any order and normalizes phones', () => {
    const rows = toStudentRows([
      ['Code', 'Mobile', 'Student Name'],
      ['S1', '1012345678', 'Sara Ali'],
      ['', '٠١١٢٣٤٥٦٧٨٩', 'Mona'],
    ]);
    expect(rows).toEqual([
      { row: 2, name: 'Sara Ali', phone: '+201012345678', internalCode: 'S1', problem: null },
      { row: 3, name: 'Mona', phone: '+201123456789', internalCode: null, problem: null },
    ]);
  });

  it('falls back to name, phone, code and skips an unknown header row', () => {
    const rows = toStudentRows([
      ['التلميذ', 'رقم ولي الأمر؟'],
      ['سارة', '01012345678', '12'],
      [],
      ['x', '01012345678'],
      ['بدون رقم', ''],
      ['رقم خطأ', '12345'],
    ]);
    expect(rows.map((r) => [r.row, r.problem])).toEqual([
      [2, null],
      [4, 'missing_name'],
      [5, 'missing_phone'],
      [6, 'invalid_phone'],
    ]);
    expect(rows[0]!.internalCode).toBe('12');
  });

  it('reads a Windows-1256 CSV end to end', () => {
    const rows = toStudentRows(readSpreadsheet('students.csv', WINDOWS_1256));
    expect(rows).toEqual([
      { row: 2, name: 'أحمد', phone: '+201012345678', internalCode: null, problem: null },
    ]);
  });
});

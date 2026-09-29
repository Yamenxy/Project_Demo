import { normalizePhone, toWesternDigits } from '@lms/shared';
import type { Sheet } from './spreadsheet';

/** One student row read from an import file, before it's checked against the workspace. */
export interface ParsedRow {
  /** The row number in the file, as the teacher sees it in Excel. */
  row: number;
  name: string;
  /** E.164 when the phone is valid, otherwise what the file had. */
  phone: string;
  internalCode: string | null;
  problem: 'missing_name' | 'missing_phone' | 'invalid_phone' | null;
}

type Column = 'name' | 'phone' | 'code';

/** Header names teachers use, compared without spaces, underscores, dashes or case. */
const HEADERS: Record<Column, string[]> = {
  name: ['name', 'fullname', 'studentname', 'student', 'الاسم', 'اسم', 'اسمالطالب', 'الطالب'],
  phone: [
    'phone',
    'mobile',
    'phonenumber',
    'mobilenumber',
    'whatsapp',
    'studentphone',
    'studentmobile',
    'الموبايل',
    'موبايل',
    'رقمالموبايل',
    'موبايلالطالب',
    'رقمالطالب',
    'الهاتف',
    'هاتف',
    'رقمالهاتف',
    'التليفون',
    'تليفون',
    'رقمالتليفون',
    'واتساب',
    'رقمالواتساب',
  ],
  code: [
    'code',
    'id',
    'studentcode',
    'studentid',
    'internalcode',
    'الكود',
    'كود',
    'كودالطالب',
    'الرقمالتعريفي',
  ],
};

const MAX_NAME = 120;
const MAX_CODE = 40;

function headerKey(cell: string): string {
  return cell.toLowerCase().replace(/[\s_\-.:]/g, '');
}

function detectHeader(row: string[]): Partial<Record<Column, number>> | null {
  const found: Partial<Record<Column, number>> = {};
  row.forEach((cell, index) => {
    const key = headerKey(cell);
    for (const column of Object.keys(HEADERS) as Column[]) {
      if (found[column] === undefined && HEADERS[column].includes(key)) found[column] = index;
    }
  });
  return found.name !== undefined && found.phone !== undefined ? found : null;
}

/**
 * Turns sheet rows into student rows. A recognised header row (Arabic or English) chooses the
 * columns; without one the columns are name, phone, code. Empty rows are skipped.
 */
export function toStudentRows(sheet: Sheet): ParsedRow[] {
  const firstIndex = sheet.findIndex((row) => row.some((cell) => cell !== ''));
  if (firstIndex < 0) return [];
  const header = detectHeader(sheet[firstIndex]!);
  let columns: Record<Column, number | undefined> = { name: 0, phone: 1, code: 2 };
  let start = firstIndex;
  if (header) {
    columns = { name: header.name, phone: header.phone, code: header.code };
    start = firstIndex + 1;
  }

  const rows: ParsedRow[] = [];
  for (let i = start; i < sheet.length; i++) {
    const cells = sheet[i]!;
    if (!cells.some((cell) => cell !== '')) continue;
    const pick = (column: Column) => {
      const index = columns[column];
      return index === undefined ? '' : (cells[index] ?? '').trim();
    };
    const name = pick('name').replace(/\s+/g, ' ').slice(0, MAX_NAME);
    const rawPhone = pick('phone');
    const phone = rawPhone ? normalizePhone(rawPhone) : null;
    const code = toWesternDigits(pick('code')).slice(0, MAX_CODE);
    let problem: ParsedRow['problem'] = null;
    if (!rawPhone) problem = 'missing_phone';
    else if (!phone) problem = 'invalid_phone';
    else if (name.length < 2) problem = 'missing_name';
    rows.push({
      row: i + 1,
      name,
      phone: phone ?? rawPhone,
      internalCode: code || null,
      problem,
    });
  }

  // Without a header, a first row that looks like one (no valid phone, while the next row has
  // one) is a header with names we don't know.
  if (!header && rows.length > 1 && rows[0]!.row === firstIndex + 1) {
    const [first, second] = rows;
    if (first!.problem && first!.problem !== 'missing_name' && !second!.problem) rows.shift();
  }
  return rows;
}

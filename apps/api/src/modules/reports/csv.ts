/**
 * CSV for spreadsheets (REQ-REPORT-001). UTF-8 with a byte-order mark, so Excel opens Arabic
 * correctly, and CRLF line ends. A cell that a spreadsheet would read as a formula (starting
 * with =, +, -, @, a tab or a carriage return) is made inert with a leading apostrophe, so a
 * student named "=HYPERLINK(...)" exports as text (CSV injection, SEC-10).
 */
const BOM = '﻿';
const FORMULA_START = /^[=+\-@\t\r]/;

export type Cell = string | number | null | undefined;

export function csvCell(value: Cell): string {
  if (value === null || value === undefined) return '';
  // Numbers are the app's own values, never formulas; negative amounts stay numbers.
  let text = typeof value === 'number' ? String(value) : value;
  if (typeof value === 'string' && FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) || text !== text.trim() ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: string[], rows: Cell[][]): string {
  const lines = [header, ...rows].map((row) => row.map(csvCell).join(','));
  return `${BOM}${lines.join('\r\n')}\r\n`;
}

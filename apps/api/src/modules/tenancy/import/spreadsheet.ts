import { inflateRawSync } from 'node:zlib';

/**
 * Reads the first sheet of an uploaded CSV or XLSX file as rows of trimmed strings
 * (REQ-USER-002). Hand-written on purpose: the import needs cell text only, and this avoids a
 * spreadsheet dependency. Formulas, styles and dates aren't interpreted.
 */
export type Sheet = string[][];

export class SpreadsheetError extends Error {}

/** Unpacked XLSX parts are capped so a small crafted file can't expand without limit. */
const MAX_UNZIPPED_BYTES = 20 * 1024 * 1024;

export function readSpreadsheet(fileName: string, data: Buffer): Sheet {
  const isZip = data.length >= 4 && data.readUInt32LE(0) === 0x04034b50;
  if (isZip || /\.xlsx$/i.test(fileName)) {
    if (!isZip) throw new SpreadsheetError('not an XLSX file');
    return readXlsx(data);
  }
  return parseCsv(decodeText(data));
}

/**
 * Text encoding detection: a byte-order mark wins; otherwise valid UTF-8 is UTF-8, and anything
 * else is taken as Windows-1256, which Arabic Excel uses when saving CSV.
 */
export function decodeText(data: Buffer): string {
  if (data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(data.subarray(3));
  }
  if (data[0] === 0xff && data[1] === 0xfe)
    return new TextDecoder('utf-16le').decode(data.subarray(2));
  if (data[0] === 0xfe && data[1] === 0xff)
    return new TextDecoder('utf-16be').decode(data.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    return new TextDecoder('windows-1256').decode(data);
  }
}

/** RFC 4180 CSV, with the delimiter (comma, semicolon or tab) guessed from the first line. */
export function parseCsv(text: string): Sheet {
  const delimiter = guessDelimiter(text);
  const rows: Sheet = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"' && cell.trim() === '') {
      quoted = true;
      cell = '';
    } else if (ch === delimiter) {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows;
}

function guessDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  let best = ',';
  let bestCount = 0;
  for (const candidate of [',', ';', '\t']) {
    const count = firstLine.split(candidate).length - 1;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

// --- XLSX ---------------------------------------------------------------------------------------

export function readXlsx(data: Buffer): Sheet {
  const files = unzip(data);
  const text = (name: string) => {
    const file = files.get(name);
    return file ? file.toString('utf-8') : undefined;
  };
  const sheetPath = firstSheetPath(text('xl/workbook.xml'), text('xl/_rels/workbook.xml.rels'));
  const sheetXml = text(sheetPath);
  if (!sheetXml) throw new SpreadsheetError('workbook has no sheet');
  const shared = sharedStrings(text('xl/sharedStrings.xml'));

  const rows: Sheet = [];
  const rowPattern = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
  let next = 1;
  for (const match of sheetXml.matchAll(rowPattern)) {
    const rowNumber = Number(attribute(match[1]!, 'r') ?? next);
    next = rowNumber + 1;
    const cells: string[] = [];
    const cellPattern = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let column = 0;
    for (const cellMatch of (match[2] ?? '').matchAll(cellPattern)) {
      const attrs = cellMatch[1]!;
      const ref = attribute(attrs, 'r');
      if (ref) column = columnIndex(ref);
      cells[column] = cellText(attrs, cellMatch[2] ?? '', shared);
      column++;
    }
    while (rows.length < rowNumber - 1) rows.push([]);
    rows.push(Array.from(cells, (value) => value ?? ''));
  }
  return rows;
}

function cellText(attrs: string, body: string, shared: string[]): string {
  const type = attribute(attrs, 't');
  if (type === 'inlineStr') return joinText(body).trim();
  const value = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
  if (value === undefined) return '';
  if (type === 's') return (shared[Number(value)] ?? '').trim();
  if (type === 'str' || type === 'e') return decodeXml(value).trim();
  if (type === 'b') return value === '1' ? 'TRUE' : 'FALSE';
  // Numbers: Excel stores phone numbers typed as numbers like 1012345678 or 1.012345678E9.
  const number = Number(value);
  if (Number.isFinite(number) && Number.isInteger(number) && Math.abs(number) < 1e21) {
    return number.toLocaleString('en-US', { useGrouping: false });
  }
  return value.trim();
}

function sharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  const pattern = /<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g;
  return Array.from(xml.matchAll(pattern), (match) => joinText(match[1] ?? ''));
}

/** The text of all <t> runs, without phonetic hints. */
function joinText(xml: string): string {
  const withoutPhonetic = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  return Array.from(withoutPhonetic.matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g), (match) =>
    decodeXml(match[1] ?? ''),
  ).join('');
}

function firstSheetPath(workbook: string | undefined, rels: string | undefined): string {
  const fallback = 'xl/worksheets/sheet1.xml';
  const sheet = workbook ? /<sheet\b([^>]*)\/?>/.exec(workbook) : null;
  const relId = sheet ? (attribute(sheet[1]!, 'r:id') ?? undefined) : undefined;
  if (!relId || !rels) return fallback;
  for (const match of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    if (attribute(match[1]!, 'Id') !== relId) continue;
    const target = attribute(match[1]!, 'Target');
    if (!target) break;
    return target.startsWith('/') ? target.slice(1) : `xl/${target}`;
  }
  return fallback;
}

function attribute(attrs: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\s)${escaped}="([^"]*)"`).exec(attrs);
  return match ? decodeXml(match[1]!) : null;
}

function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? 'A';
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

function decodeXml(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (_, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower === 'lt') return '<';
    if (lower === 'gt') return '>';
    if (lower === 'amp') return '&';
    if (lower === 'quot') return '"';
    if (lower === 'apos') return "'";
    const code = lower.startsWith('#x')
      ? parseInt(lower.slice(2), 16)
      : parseInt(lower.slice(1), 10);
    return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });
}

/** The zip entries of an XLSX file (stored or deflated; no zip64, which small files never use). */
function unzip(data: Buffer): Map<string, Buffer> {
  const eocd = findEndOfCentralDirectory(data);
  const count = data.readUInt16LE(eocd + 10);
  let offset = data.readUInt32LE(eocd + 16);
  const files = new Map<string, Buffer>();
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > data.length || data.readUInt32LE(offset) !== 0x02014b50) {
      throw new SpreadsheetError('damaged zip directory');
    }
    const method = data.readUInt16LE(offset + 10);
    const compressedSize = data.readUInt32LE(offset + 20);
    const nameLength = data.readUInt16LE(offset + 28);
    const extraLength = data.readUInt16LE(offset + 30);
    const commentLength = data.readUInt16LE(offset + 32);
    const localOffset = data.readUInt32LE(offset + 42);
    const name = data.subarray(offset + 46, offset + 46 + nameLength).toString('utf-8');
    offset += 46 + nameLength + extraLength + commentLength;

    if (!name.endsWith('.xml') && !name.endsWith('.rels')) continue;
    if (localOffset + 30 > data.length || data.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new SpreadsheetError('damaged zip entry');
    }
    const start =
      localOffset + 30 + data.readUInt16LE(localOffset + 26) + data.readUInt16LE(localOffset + 28);
    const raw = data.subarray(start, start + compressedSize);
    let content: Buffer;
    try {
      if (method === 0) content = Buffer.from(raw);
      else if (method === 8) {
        content = inflateRawSync(raw, { maxOutputLength: MAX_UNZIPPED_BYTES - total });
      } else throw new SpreadsheetError('unsupported compression');
    } catch (err) {
      if (err instanceof SpreadsheetError) throw err;
      throw new SpreadsheetError('damaged or too large zip entry');
    }
    total += content.length;
    if (total > MAX_UNZIPPED_BYTES) throw new SpreadsheetError('file expands too much');
    files.set(name, content);
  }
  return files;
}

function findEndOfCentralDirectory(data: Buffer): number {
  const lowest = Math.max(0, data.length - 22 - 0xffff);
  for (let i = data.length - 22; i >= lowest; i--) {
    if (data.readUInt32LE(i) === 0x06054b50) return i;
  }
  throw new SpreadsheetError('not a zip file');
}

/** Splits text into plain parts and `$…$` maths parts (a `\$` stays a dollar sign). */
export function splitMath(text: string): { math: boolean; value: string }[] {
  const parts: { math: boolean; value: string }[] = [];
  const pattern = /(?<!\\)\$([^$]+?)(?<!\\)\$/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) parts.push({ math: false, value: text.slice(last, match.index) });
    parts.push({ math: true, value: match[1] ?? '' });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ math: false, value: text.slice(last) });
  return parts.map((p) => (p.math ? p : { ...p, value: p.value.replace(/\\\$/g, '$') }));
}

const ZERO_WIDTH_MARKS = [/\u200B/g, /\u200C/g, /\u200D/g, /\uFEFF/g];
const NBSP = /\u00A0/g;
const SMART_SINGLE = /[\u2018\u2019]/g;
const SMART_DOUBLE = /[\u201C\u201D]/g;
const EM_DASH = /[\u2013\u2014]/g;
const PUNCTUATION: ReadonlyArray<readonly [RegExp, string]> = [
  [/，/g, ','],
  [/。/g, '.'],
  [/；/g, ';'],
  [/：/g, ':'],
  [/！/g, '!'],
  [/？/g, '?'],
  [/（/g, '('],
  [/）/g, ')'],
  [/【/g, '['],
  [/】/g, ']'],
];

/** Normalize pasted web text: invisible marks, NBSP, newlines, smart quotes, full-width punctuation. */
export function sanitizePastedText(raw: string): string {
  let next = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (const mark of ZERO_WIDTH_MARKS) {
    next = next.replace(mark, '');
  }
  next = next.replace(NBSP, ' ');
  next = next.replace(SMART_SINGLE, "'");
  next = next.replace(SMART_DOUBLE, '"');
  next = next.replace(EM_DASH, '-');
  for (const [pattern, replacement] of PUNCTUATION) {
    next = next.replace(pattern, replacement);
  }
  return next;
}

/**
 * How the values inside a case chapter read on the page. Chapters are often JSON written by tools or people
 * (`spatial_pattern: "view_space"`, `category_primary: "Shader.Compiler.ConstantFolding"`); the reader turns
 * keys and enum-like values into words, keeps identifiers an engineer searches for as code, and leaves internal
 * references (stored asset ids, session addresses) off the page. None of this knows a particular case.
 */

export type CaseValue = null | boolean | number | string | CaseValue[] | { [key: string]: CaseValue };
export type CaseRecord = { [key: string]: CaseValue };

export function parseChapterValue(content: string): CaseValue | undefined {
  const text = content.trim();
  if (!text.startsWith('{') && !text.startsWith('[')) return undefined;
  try { return JSON.parse(text) as CaseValue; } catch { return undefined; }
}

export const isCaseRecord = (value: CaseValue | undefined): value is CaseRecord => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

/** A stored asset id or a session address means something to the store, nothing to a reader. */
export function isInternalReference(value: string): boolean {
  const text = value.trim();
  return /^asset-[0-9a-f]{6,}$/iu.test(text) || /^session:\/\//u.test(text);
}

/** Drops internal references from a value; an object or list left empty disappears with them. */
export function withoutInternalReferences(value: CaseValue): CaseValue | undefined {
  if (typeof value === 'string') return isInternalReference(value) ? undefined : value;
  if (Array.isArray(value)) {
    const kept = value.map(withoutInternalReferences).filter((item): item is CaseValue => item !== undefined);
    return kept.length ? kept : undefined;
  }
  if (isCaseRecord(value)) {
    const kept = Object.entries(value).flatMap(([key, item]) => {
      const next = withoutInternalReferences(item);
      return next === undefined ? [] : [[key, next] as const];
    });
    return kept.length ? Object.fromEntries(kept) : undefined;
  }
  return value;
}

const splitWords = (text: string): string[] => text
  .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
  .split(/[_\s-]+/u)
  .filter(Boolean);

/** `spatial_pattern` or `featureConfiguration` as a sentence-cased label: "Spatial pattern", "Feature configuration". */
export function humanizeKey(key: string): string {
  const words = splitWords(key).map((word) => (/^[A-Z0-9]+$/u.test(word) ? word : word.toLowerCase()));
  if (!words.length) return key;
  return [words[0]!.charAt(0).toUpperCase() + words[0]!.slice(1), ...words.slice(1)].join(' ');
}

const ENUM_LIKE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/u;
const DOTTED_CATEGORY = /^[A-Z][A-Za-z0-9]*(?:\.[A-Z][A-Za-z0-9]*)+$/u;

/** Whether a value is written as an enum (`view_space`) or a dotted category rather than as words. */
export const isTermLike = (value: string): boolean => ENUM_LIKE.test(value) || DOTTED_CATEGORY.test(value);

/** `view_space` → "view space"; `Shader.Compiler.ConstantFolding` → "Shader › Compiler › Constant Folding". */
export function humanizeTerm(value: string): string {
  if (DOTTED_CATEGORY.test(value)) return value.split('.').map((part) => splitWords(part).join(' ')).join(' › ');
  if (ENUM_LIKE.test(value)) return value.replace(/_/gu, ' ');
  return value;
}

/**
 * Identifiers worth searching for: SPIR-V ids and ranges (`%17`, `%20-%24`) and hyphenated upper-case ids
 * (`I-NORM-02`). They render as inline code inside otherwise plain sentences.
 */
const IDENTIFIER = /(%\d+(?:-%\d+)?|\b[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+\b)/gu;

export interface TextSegment {
  text: string;
  code: boolean;
}

export function splitIdentifiers(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(IDENTIFIER)) {
    const start = match.index ?? 0;
    if (start > last) segments.push({ text: text.slice(last, start), code: false });
    segments.push({ text: match[0], code: true });
    last = start + match[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last), code: false });
  return segments;
}

/**
 * A short Latin token that names something in the engine or a shader (`Mesh_Body`, `Props/Crate`,
 * `:EvaluateLight -> Light.Radiance`) reads best as code; prose in any language does not.
 */
export function looksLikeIdentifier(value: string): boolean {
  const text = value.trim();
  if (!text || text.length > 120 || /[　-鿿]/u.test(text)) return false;
  if (splitIdentifiers(text).every((segment) => segment.code)) return true;
  // A single token: a path, a dotted member, a snake_case name, a SPIR-V id.
  if (!/\s/u.test(text)) return /[_/:.()%]|[a-z][A-Z]/u.test(text);
  // A short expression or symbol reference with spaces (`a -> b`, `x = f(y)`, `:Func (Detail)`), never a sentence.
  if (/[.!?]$|[.!?]\s/u.test(text) || text.split(/\s+/u).length > 8) return false;
  return /->|=|\w\(/u.test(text) || /^[:%]/u.test(text);
}

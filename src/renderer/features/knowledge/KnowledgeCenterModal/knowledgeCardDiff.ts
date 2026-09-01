import type { KnowledgeCardRecord } from '@shared/types/knowledge';

export interface KnowledgeDiffLine {
  kind: 'same' | 'add' | 'remove';
  text: string;
}

const COMPARE_FIELDS: Array<keyof KnowledgeCardRecord> = [
  'title',
  'type',
  'lifecycle',
  'sourceStatus',
  'caseId',
];

function lineDiff(before: string, after: string): KnowledgeDiffLine[] {
  const left = before.split(/\r?\n/);
  const right = after.split(/\r?\n/);
  const lines: KnowledgeDiffLine[] = [];
  const max = Math.max(left.length, right.length);
  for (let index = 0; index < max; index += 1) {
    const prev = left[index];
    const next = right[index];
    if (prev === next) {
      if (next != null) lines.push({ kind: 'same', text: next });
      continue;
    }
    if (prev != null) lines.push({ kind: 'remove', text: prev });
    if (next != null) lines.push({ kind: 'add', text: next });
  }
  return lines;
}

export function diffKnowledgeCard(
  before: KnowledgeCardRecord | null,
  after: KnowledgeCardRecord,
): KnowledgeDiffLine[] {
  const lines: KnowledgeDiffLine[] = [];
  for (const field of COMPARE_FIELDS) {
    const prev = before ? String(before[field] ?? '') : '';
    const next = String(after[field] ?? '');
    if (prev === next) continue;
    if (prev) lines.push({ kind: 'remove', text: `${String(field)}: ${prev}` });
    if (next) lines.push({ kind: 'add', text: `${String(field)}: ${next}` });
  }
  const beforeScope = before ? JSON.stringify(before.scope ?? {}) : '';
  const afterScope = JSON.stringify(after.scope ?? {});
  if (beforeScope !== afterScope) {
    if (beforeScope) lines.push({ kind: 'remove', text: `scope: ${beforeScope}` });
    lines.push({ kind: 'add', text: `scope: ${afterScope}` });
  }
  lines.push(...lineDiff(before?.body ?? '', after.body));
  return lines;
}

export async function rollbackBasis(source: string): Promise<{ hash: string; bytes: number }> {
  const bytes = new TextEncoder().encode(source);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
  return { hash, bytes: bytes.byteLength };
}

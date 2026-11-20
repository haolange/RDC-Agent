import type { KnowledgeCardRecord } from '@shared/types/knowledge';
import { diffLines, type DiffLine } from '@shared/utils/lineDiff';

const COMPARE_FIELDS: Array<keyof KnowledgeCardRecord> = [
  'title',
  'type',
  'lifecycle',
  'sourceStatus',
  'caseId',
];

export function diffKnowledgeCard(
  before: KnowledgeCardRecord | null,
  after: KnowledgeCardRecord,
): DiffLine[] {
  const lines: DiffLine[] = [];
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
  lines.push(...diffLines(before?.body ?? '', after.body));
  return lines;
}

export async function rollbackBasis(source: string): Promise<{ hash: string; bytes: number }> {
  const bytes = new TextEncoder().encode(source);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
  return { hash, bytes: bytes.byteLength };
}

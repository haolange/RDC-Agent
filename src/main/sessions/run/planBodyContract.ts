import { PLAN_EXECUTION_REFERENCES_HEADING, splitPlanAppendix } from '@shared/utils/planAppendix';
import { AppError } from '@shared/errors/appError';

/** Internal references belong in plan_artifact fields or the execution appendix, never in the reader-facing text. */
const INTERNAL_REFERENCES: Array<{ kind: string; pattern: RegExp }> = [
  { kind: 'session artifact URI', pattern: /session:\/\/[^\s)\]`'"，。；]+/g },
  { kind: 'record id', pattern: /\b[a-z][a-z-]*-[0-9a-f]{12}-\d{13}\b/g },
  { kind: 'task or execution id', pattern: /\b(?:task|execution)_\d{13}_[0-9a-f]{8}\b/g },
  { kind: 'tool call id', pattern: /\bcall_[0-9A-Za-z]{16,}\b/g },
  { kind: 'uuid', pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi },
  { kind: 'hash', pattern: /\b(?=[0-9a-fA-F]*[a-fA-F])(?=[0-9a-fA-F]*\d)[0-9a-fA-F]{16,}\b/g },
];

/** Every internal reference in `text`, in order of appearance; overlapping matches keep the first kind. */
export function findInternalReferences(text: string): Array<{ kind: string; value: string }> {
  const found = new Map<number, { kind: string; value: string; end: number }>();
  for (const { kind, pattern } of INTERNAL_REFERENCES) {
    for (const match of text.matchAll(pattern)) {
      const start = match.index;
      const end = start + match[0].length;
      const overlaps = [...found.entries()].some(([other, entry]) => start < entry.end && other < end);
      if (!overlaps) found.set(start, { kind, value: match[0], end });
    }
  }
  return [...found.entries()].sort(([left], [right]) => left - right).map(([, { kind, value }]) => ({ kind, value }));
}

/**
 * The plan body is what the user reads to understand the strategy. Executor references go into
 * structured plan_artifact fields or into a final `## Execution references` section.
 */
export function assertReaderFacingPlan(input: { title: string; summary: string[]; content: string }): void {
  const content = input.content.replace(/\r\n/g, '\n');
  const appendixHeadings = content.split('\n').filter((line) => line.trim() === PLAN_EXECUTION_REFERENCES_HEADING).length;
  if (appendixHeadings > 1) throw new AppError('PLAN_BODY_INVALID', `write a single "${PLAN_EXECUTION_REFERENCES_HEADING}" section.`);
  const { body, appendix } = splitPlanAppendix(content);
  if (appendix && /^##[ \t]+/m.test(appendix.split('\n').slice(1).join('\n'))) {
    throw new AppError('PLAN_BODY_INVALID', `"${PLAN_EXECUTION_REFERENCES_HEADING}" must be the last section; move the sections after it above it.`);
  }
  const references = findInternalReferences([input.title, ...input.summary, body].join('\n'));
  if (!references.length) return;
  const listed = references.slice(0, 5).map((entry) => `${entry.kind} "${entry.value}"`).join('; ');
  throw new AppError('PLAN_BODY_INTERNAL_REFERENCE', `the title, summary and body are read by the user, so name objects instead of citing internal references. Move ${references.length} reference(s) to plan_artifact fields (requiredTaskIds, captureScope) or to a final "${PLAN_EXECUTION_REFERENCES_HEADING}" section: ${listed}.`);
}

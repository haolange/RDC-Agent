/** Why a remaining item cannot proceed now. `not_required` marks work outside what the goal needs. */
export const UNRESOLVED_BLOCKERS = ['capability', 'permission', 'budget', 'strategy', 'external', 'not_required'] as const;
export type UnresolvedBlocker = (typeof UNRESOLVED_BLOCKERS)[number];

/** One remaining item of a turn or Task result. */
export interface UnresolvedItem {
  /** What remains unknown or undone. */
  gap: string;
  /** What was already tried, or that nothing was tried and why. */
  attempted: string;
  blocker: UnresolvedBlocker;
  /** The concrete condition under which the item can proceed. */
  resumeWhen: string;
}

const MAX_TEXT = 1_000;

/** Parse model-supplied items; any malformed item rejects the whole list. */
export function parseUnresolvedItems(value: unknown): UnresolvedItem[] {
  if (!Array.isArray(value) || value.length > 32) throw new Error('TURN_COMPLETION_INVALID: result.unresolved must be an array of at most 32 items.');
  return value.map((item, index) => {
    const record = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : null;
    const text = (field: string) => {
      const raw = record?.[field];
      if (typeof raw !== 'string' || !raw.trim() || raw.length > MAX_TEXT) {
        throw new Error(`TURN_COMPLETION_INVALID: result.unresolved[${index}].${field} must be a non-empty string of at most ${MAX_TEXT} characters.`);
      }
      return raw.trim();
    };
    const blocker = record?.blocker;
    if (!UNRESOLVED_BLOCKERS.includes(blocker as UnresolvedBlocker)) {
      throw new Error(`TURN_COMPLETION_INVALID: result.unresolved[${index}].blocker must be one of ${UNRESOLVED_BLOCKERS.join(', ')}. An item without a real blocker is work to continue, not a reason to stop.`);
    }
    return { gap: text('gap'), attempted: text('attempted'), blocker: blocker as UnresolvedBlocker, resumeWhen: text('resumeWhen') };
  });
}

/** One-line rendering for prompts and text summaries; historical string entries pass through. */
export function formatUnresolvedItem(item: UnresolvedItem | string): string {
  return typeof item === 'string' ? item
    : `${item.gap} — tried: ${item.attempted} — blocked by ${item.blocker} — resumes when: ${item.resumeWhen}`;
}

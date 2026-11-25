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

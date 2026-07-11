import type { WorkProcessRow } from './workProcessTypes';

/** One projected llm_turn (or standalone block cluster) in narrative order. */
export interface LoopPresentationUnit {
  kind: 'loop';
  loopId: string;
  rows: WorkProcessRow[];
  hasDisplayableThinking: boolean;
  hasSummaryThinking: boolean;
  isResponseBoundary?: boolean;
}

export interface StandalonePresentationUnit {
  kind: 'standalone';
  rows: WorkProcessRow[];
  loopIds: string[];
}

export type PresentationUnit = LoopPresentationUnit | StandalonePresentationUnit;

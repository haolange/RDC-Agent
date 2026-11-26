import { expect } from 'vitest';
import { KNOWLEDGE_OPERATION_PHASES, type KnowledgeOperationProgress } from '@shared/types/knowledgeOperation';

/** Phases never go back, and within a phase `done` never goes back or past `total`. */
export function expectMonotonicProgress(
  events: readonly Pick<KnowledgeOperationProgress, 'phase' | 'done' | 'total'>[],
): void {
  for (const [index, event] of events.entries()) {
    expect(event.done).toBeLessThanOrEqual(event.total);
    const previous = events[index - 1];
    if (!previous) continue;
    const order = KNOWLEDGE_OPERATION_PHASES.indexOf(event.phase) - KNOWLEDGE_OPERATION_PHASES.indexOf(previous.phase);
    expect(order).toBeGreaterThanOrEqual(0);
    if (order === 0) expect(event.done).toBeGreaterThanOrEqual(previous.done);
  }
}

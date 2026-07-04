import type { WorkProcessSemanticStepKind } from './workProcessSemanticKind';
import type { WorkProcessIconKey } from './workProcessTypes';

export const SEMANTIC_STEP_ICONS: Record<WorkProcessSemanticStepKind, WorkProcessIconKey> = {
  explore: 'search',
  web: 'globe',
  change: 'edit',
  verify: 'terminal',
  interaction: 'question',
  collaboration: 'handoff',
  memory: 'memory',
  diagnostic: 'warning',
  compaction: 'brain',
};

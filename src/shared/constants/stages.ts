/**
 * Workflow Stage Constants - Debugger 生产级阶段定义
 */

import type { WorkflowPhase, WorkflowStage } from '../types/workflow';

export const MAIN_STAGES: WorkflowStage[] = [
  'preflight',
  'entry_gate',
  'speclist',
  'dispatch',
  'investigate',
  'fix_verify',
  'skepti',
  'curate',
  'finalize',
];

export const SPECIAL_STAGES: WorkflowStage[] = [
  'blocked',
];

export const ALL_STAGES: WorkflowStage[] = [...MAIN_STAGES, ...SPECIAL_STAGES];

export const STAGE_DISPLAY_NAMES: Record<WorkflowStage, string> = {
  preflight: 'Preflight',
  entry_gate: 'Entry Gate',
  speclist: 'Speclist',
  dispatch: 'Dispatch',
  investigate: 'Investigate',
  fix_verify: 'Fix Verify',
  skepti: 'Skepti',
  curate: 'Curate',
  finalize: 'Finalize',
  blocked: 'Blocked',
};

export const STAGE_PHASES: Record<WorkflowStage, WorkflowPhase> = {
  preflight: 'planner',
  entry_gate: 'planner',
  speclist: 'planner',
  dispatch: 'generator',
  investigate: 'generator',
  fix_verify: 'evaluator',
  skepti: 'evaluator',
  curate: 'evaluator',
  finalize: 'evaluator',
  blocked: 'evaluator',
};

export const STAGE_GROUPS: Record<string, WorkflowStage[]> = {
  planner: ['preflight', 'entry_gate', 'speclist'],
  generator: ['dispatch', 'investigate'],
  evaluator: ['fix_verify', 'skepti', 'curate', 'finalize'],
};

export const SIMPLIFIED_STAGES: Array<{ id: string; name: string; stages: WorkflowStage[] }> = [
  { id: 'planner', name: 'Planner', stages: STAGE_GROUPS.planner },
  { id: 'generator', name: 'Generator', stages: STAGE_GROUPS.generator },
  { id: 'evaluator', name: 'Evaluator', stages: STAGE_GROUPS.evaluator },
];

export const normalizeWorkflowStage = (stage: string | undefined | null): WorkflowStage => {
  if (!stage) return 'preflight';
  if (ALL_STAGES.includes(stage as WorkflowStage)) return stage as WorkflowStage;
  return 'preflight';
};

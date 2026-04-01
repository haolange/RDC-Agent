/**
 * Workflow Stage Constants - 工作流阶段常量定义
 */

import type { WorkflowStage } from '../types/workflow';

// 主流程阶段（固定顺序）
export const MAIN_STAGES: WorkflowStage[] = [
  'preflight_pending',
  'intent_gate_passed',
  'entry_gate_passed',
  'accepted_intake_initialized',
  'intake_gate_passed',
  'waiting_for_specialist_brief',
  'specialist_briefs_collected',
  'expert_investigation_complete',
  'fix_verification_complete',
  'skeptic_ready',
  'curator_ready',
  'finalized',
];

// 特殊状态（非主流程）
export const SPECIAL_STAGES: WorkflowStage[] = [
  'validation_blocked',
  'awaiting_user_input',
];

// 所有阶段
export const ALL_STAGES: WorkflowStage[] = [...MAIN_STAGES, ...SPECIAL_STAGES];

// 阶段显示名称
export const STAGE_DISPLAY_NAMES: Record<WorkflowStage, string> = {
  'preflight_pending': 'Preflight',
  'intent_gate_passed': 'Intent Gate',
  'entry_gate_passed': 'Entry Gate',
  'accepted_intake_initialized': 'Intake Initialized',
  'intake_gate_passed': 'Intake Gate',
  'waiting_for_specialist_brief': 'Waiting for Specialist',
  'specialist_briefs_collected': 'Briefs Collected',
  'expert_investigation_complete': 'Investigation Complete',
  'fix_verification_complete': 'Fix Verification',
  'skeptic_ready': 'Skeptic Ready',
  'curator_ready': 'Curator Ready',
  'finalized': 'Finalized',
  'validation_blocked': 'Blocked',
  'awaiting_user_input': 'Awaiting Input',
};

// 阶段分组（用于UI显示）
export const STAGE_GROUPS: Record<string, WorkflowStage[]> = {
  intake: ['preflight_pending', 'intent_gate_passed', 'entry_gate_passed', 'accepted_intake_initialized', 'intake_gate_passed'],
  investigation: ['waiting_for_specialist_brief', 'specialist_briefs_collected', 'expert_investigation_complete'],
  verification: ['fix_verification_complete', 'skeptic_ready'],
  finalization: ['curator_ready', 'finalized'],
};

// 阶段显示顺序（简化版，用于WorkflowPanel）
export const SIMPLIFIED_STAGES: Array<{ id: string; name: string; stages: WorkflowStage[] }> = [
  { id: 'intake', name: 'Intake', stages: STAGE_GROUPS.intake },
  { id: 'investigation', name: 'Investigation', stages: STAGE_GROUPS.investigation },
  { id: 'verification', name: 'Verification', stages: STAGE_GROUPS.verification },
  { id: 'finalization', name: 'Final', stages: STAGE_GROUPS.finalization },
];

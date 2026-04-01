/**
 * Workflow Types - 工作流状态机相关类型定义
 */

// 工作流阶段（12阶段 + 新增阻断/等待阶段）
export type WorkflowStage =
  | 'preflight_pending'
  | 'intent_gate_passed'
  | 'entry_gate_passed'
  | 'accepted_intake_initialized'
  | 'intake_gate_passed'
  | 'waiting_for_specialist_brief'
  | 'specialist_briefs_collected'
  | 'expert_investigation_complete'
  | 'fix_verification_complete'
  | 'skeptic_ready'
  | 'curator_ready'
  | 'finalized'
  | 'validation_blocked'      // 新增：发现blocker时的阻断态
  | 'awaiting_user_input';    // 新增：等待用户输入

// 工作流状态
export interface WorkflowState {
  caseId: string;
  runId: string;
  sessionId: string;
  currentStage: WorkflowStage;
  previousStages: WorkflowStage[];
  entryMode: 'cli' | 'mcp';
  backend: 'local' | 'remote';
  orchestrationMode: 'multi_agent';  // 垂直简化：只支持multi_agent
  coordinationMode: 'staged_handoff'; // 垂直简化：只支持staged_handoff
  blockers: Blocker[];
  lastUpdated: string;
}

// 阻断器
export interface Blocker {
  code: string;
  reason: string;
  refs: string[];
  detectedAt: string;
  resolvedAt?: string;
}

// 回转触发条件
export type BacktrackTrigger =
  | 'specialist_timeout'
  | 'skeptic_rejected'
  | 'triage_low_confidence'
  | 'blocker_detected'
  | 'user_requested';

// 回转规则
export interface BacktrackRule {
  fromStage: WorkflowStage;
  toStage: WorkflowStage;
  trigger: BacktrackTrigger;
  maxRetries: number;
  requiresUserConfirmation: boolean;
}

// 回转上下文
export interface BacktrackContext {
  reason: string;
  trigger: BacktrackTrigger;
  agentId?: string;
  details?: Record<string, unknown>;
}

// Gate结果
export interface GateResult {
  stage: string;
  status: 'passed' | 'blocked' | 'pending';
  blockers: Blocker[];
  refs: string[];
  paths: Record<string, string>;
  extra?: Record<string, unknown>;
}

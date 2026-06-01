/**
 * Workflow Types - 工作流状态机相关类型定义
 */

import type { AgentRole } from './agent';
import type { HarnessTask } from './harness';

// Debugger 工作流阶段（生产级单一路径）
export type WorkflowStage =
  | 'preflight'
  | 'entry_gate'
  | 'intake_gate'
  | 'plan'
  | 'speclist'
  | 'dispatch'
  | 'investigate'
  | 'fix_verify'
  | 'skepti'
  | 'curate'
  | 'finalize'
  | 'blocked'
  | 'awaiting_user_input';

export type WorkflowPhase =
  | 'planner'
  | 'generator'
  | 'evaluator';

export type PlanReadiness =
  | 'discovering'
  | 'needs_user_input'
  | 'ready_for_approval'
  | 'strict_ready'
  | 'blocked';

export interface AskUserQuestionOption {
  id: string;
  label: string;
  description: string;
}

export interface AskUserQuestion {
  id: string;
  prompt: string;
  recommendedOptionId?: string;
  options: [
    AskUserQuestionOption,
    AskUserQuestionOption,
    AskUserQuestionOption,
    AskUserQuestionOption,
  ];
  freeformPlaceholder?: string;
}

export interface AskUserPrompt {
  promptId: string;
  title: string;
  summary: string;
  questions: AskUserQuestion[];
  createdAt: string;
}

export interface AskUserAnswer {
  questionId: string;
  selectedOptionId?: string;
  freeformText?: string;
}

export interface ReferenceContract {
  taskSources: string[];
  referenceCaptures: string[];
  acceptanceNotes: string[];
}

export interface VerificationContract {
  requiresFixValidation: boolean;
  requiresScreenshotEvidence: boolean;
  requiresShaderInspection: boolean;
  requiresPixelEvidence: boolean;
  requiresBaselineComparison: boolean;
  targetEventIds: number[];
  successCriteria: string[];
}

export interface PlanPresentationSection {
  id: string;
  title: string;
  body: string[];
}

export interface PlanPresentation {
  title: string;
  sections: PlanPresentationSection[];
}

export interface DebugPlan {
  planId: string;
  planReadiness: PlanReadiness;
  strictReady: boolean;
  userGoal: string;
  targetCapture: {
    captureId: string;
    fileName: string;
    filePath: string;
  } | null;
  targetFrameOrEvent: {
    scope: 'event' | 'frame' | 'capture';
    frameIndex?: number;
    eventId?: number;
    eventLabel?: string;
  } | null;
  scope: string;
  referenceContract: ReferenceContract;
  verificationContract: VerificationContract;
  presentation?: PlanPresentation;
  expectedDeliverables: string[];
  blockers: Blocker[];
  missingInfo: string[];
  recommendedSpecialists: AgentRole[];
  notes: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ReasoningSummary {
  summaryId: string;
  stage: WorkflowStage;
  agentId: AgentRole;
  summary: string;
  evidence: string[];
  nextStep: string;
  confidence: number;
  createdAt: string;
}

export interface RunRecoveryState {
  restartedFromRunId?: string;
  recoveredAt?: string;
  recoveryReason?: string;
  staleDetectedAt?: string;
}

export interface IntakeContext {
  taskFilePath?: string;
  taskFileContent?: string;
  effectiveGoal: string;
  discoveredProjectRoot?: string;
  openedCaptureId?: string | null;
  openedCapturePath?: string | null;
  availableCaptureIds: string[];
  providerId?: string;
  modelId?: string;
  replayDeviceId?: string | null;
  replayDeviceLabel?: string | null;
}

export type PlanApprovalState =
  | 'not_requested'
  | 'pending_user'
  | 'approved'
  | 'rejected';

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
  planReadiness?: PlanReadiness;
  approvalState?: PlanApprovalState;
  debugPlan?: DebugPlan | null;
  harnessTasks?: HarnessTask[];
  pendingQuestions?: AskUserPrompt | null;
  reasoningSummaries?: ReasoningSummary[];
  recoveryState?: RunRecoveryState | null;
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

/** Discriminated view for renderer type-narrowing; runtime JSON shape unchanged. */
export type WorkflowStateView =
  | (WorkflowState & { currentStage: 'plan'; debugPlan: DebugPlan })
  | (WorkflowState & { currentStage: 'awaiting_user_input'; pendingQuestions: AskUserPrompt })
  | (WorkflowState & { currentStage: 'blocked'; blockers: [Blocker, ...Blocker[]] })
  | WorkflowState;

// Gate结果
export interface GateResult {
  stage: string;
  status: 'passed' | 'blocked' | 'pending';
  blockers: Blocker[];
  refs: string[];
  paths: Record<string, string>;
  extra?: Record<string, unknown>;
}

/** 最终报告 */
export interface Report {
  title: string;
  summary: string;
  rootCause: string;
  fixDescription: string;
  evidenceSummary: string[];
  recommendations: string[];
  confidence: number;
  generatedAt: string;
  curatorAgentId: string;
}

// ============================================
// Mode Capabilities 类型
// ============================================

/** 模式能力定义 */
export interface ModeCapabilities {
  mode: import('./session').AppMode;
  availableStages: WorkflowStage[];
  requiresLLM: boolean;
  isFullyImplemented: boolean;
  disabledReason?: string;
}

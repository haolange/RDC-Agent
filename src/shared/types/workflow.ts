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

// ============================================
// LangGraph GraphState（工作流图状态）
// ============================================

/** Capture 元数据 */
export interface CaptureMetadata {
  api: string;
  device: string;
  driverVersion: string;
  frameCount: number;
  eventCount: number;
  captureDate: string;
  fileSize: number;
  features: string[];
}

/** Replay 会话 */
export interface ReplaySession {
  sessionId: string;
  currentFrame: number;
  selectedEvent: number;
}

/** Capture 信息 */
export interface CaptureInfo {
  fileId: string;
  filePath: string;
  metadata: CaptureMetadata;
}

/** Specialist 状态 */
export interface SpecialistState {
  agentId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'timeout';
  brief?: string;
  artifacts: string[];
  startedAt?: string;
  completedAt?: string;
  error?: string;
  retryCount: number;
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

/** LangGraph 工作流图状态 — StateGraph 的完整状态 */
export interface GraphState {
  // 身份
  caseId: string;
  runId: string;
  sessionId: string;

  // 阶段
  currentStage: WorkflowStage;
  stageHistory: WorkflowStage[];

  // 用户输入
  userGoal: string;
  capturePaths: string[];

  // RDC 上下文
  captureInfo?: CaptureInfo;
  replaySession?: ReplaySession;

  // 证据链
  evidenceChain: Array<{
    eventId: string;
    eventType: string;
    agentId: string;
    status: string;
    timestamp: number;
    payload: Record<string, unknown>;
  }>;
  artifacts: Array<{
    id: string;
    type: string;
    path: string;
    agentId: string;
    createdAt: string;
  }>;

  // Specialist 追踪
  activeSpecialists: Record<string, SpecialistState>;
  pendingBriefs: string[];
  collectedBriefs: Record<string, string>;

  // 阻断/等待
  blockers: Blocker[];
  interruptReason?: string;

  // 回转追踪
  backtrackCount: Record<string, number>;

  /** 回转批评记录 - 记录每次拒绝的失败原因，供后续节点注入以避免重复失败 */
  backtrackCritiques: Record<string, string[]>;

  // 结果
  finalReport?: Report;
  fixVerified: boolean;

  // 元数据
  entryMode: 'cli' | 'mcp';
  backend: 'local' | 'remote';
  orchestrationMode: 'multi_agent';
  coordinationMode: 'staged_handoff';
  lastUpdated: string;
}

/** 从 GraphState 投影到 IPC WorkflowState 的转换函数类型 */
export type GraphStateProjection = (graphState: GraphState) => WorkflowState;

// ============================================
// Mode Capabilities 类型
// ============================================

/** 模式能力定义 */
export interface ModeCapabilities {
  mode: 'debugger' | 'analyzer' | 'optimizer';
  availableStages: WorkflowStage[];
  requiresLLM: boolean;
  isFullyImplemented: boolean;
  disabledReason?: string;
}

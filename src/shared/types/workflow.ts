/**
 * Workflow Types - 工作流状态机相关类型定义
 */

import type { ReplayDeviceEntry } from './device';
import type { AppMode, CaptureDescriptor } from './session';

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
  objective?: string;
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
  captures: CaptureDescriptor[];
  primaryCaptureId: string;
  replayDevice: ReplayDeviceEntry | null;
  mode: AppMode;
  goal: string;

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
  mode: import('./session').AppMode;
  availableStages: WorkflowStage[];
  requiresLLM: boolean;
  isFullyImplemented: boolean;
  disabledReason?: string;
}

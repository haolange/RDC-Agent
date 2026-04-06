/**
 * NodeFunctions/utils.ts - 节点函数公共工具
 * 提供证据创建、状态投影、阻断检查等工具函数
 */

import { randomUUID } from 'crypto';
import type {
  GraphState,
  WorkflowStage,
  WorkflowPhase,
  Blocker,
  WorkflowState,
  SpecialistState,
} from '../../../shared/types/workflow';
import type { AgentRole } from '../../../shared/types/agent';
import type { EffectiveAgentRuntimeConfig } from '../../../shared/types/profile';
import { settingsService } from '../SettingsService';
import { executionProfileService } from '../ExecutionProfileService';
import { runExecutionService } from '../RunExecutionService';

/** 证据链事件 */
export interface EvidenceEvent {
  eventId: string;
  eventType: string;
  agentId: string;
  status: string;
  timestamp: number;
  payload: Record<string, unknown>;
}

/** 工件 */
export interface Artifact {
  id: string;
  type: string;
  path: string;
  agentId: string;
  createdAt: string;
}

/** 记录阶段转换到证据链 */
export function createStageTransitionEvidence(
  state: { sessionId: string; runId: string; currentStage: WorkflowStage },
  newStage: WorkflowStage,
  agentId: AgentRole = 'rdc-debugger'
): EvidenceEvent {
  return {
    eventId: randomUUID(),
    eventType: 'workflow_stage_transition',
    agentId,
    status: 'ok',
    timestamp: Date.now(),
    payload: {
      fromStage: state.currentStage,
      toStage: newStage,
      runId: state.runId,
      sessionId: state.sessionId,
    },
  };
}

/** 记录工具执行到证据链 */
export function createToolExecutionEvidence(
  state: { sessionId: string; runId: string },
  toolName: string,
  args: Record<string, unknown>,
  result: { ok: boolean; data?: unknown; error?: unknown },
  agentId: AgentRole = 'rdc-debugger'
): EvidenceEvent {
  return {
    eventId: randomUUID(),
    eventType: 'tool_execution',
    agentId,
    status: result.ok ? 'ok' : 'error',
    timestamp: Date.now(),
    payload: {
      toolName,
      args,
      result: result.ok ? 'success' : 'failed',
      error: result.error,
      runId: state.runId,
      sessionId: state.sessionId,
    },
  };
}

/** 记录 dispatch 事件 */
export function createDispatchEvidence(
  state: { sessionId: string; runId: string },
  targetAgent: AgentRole,
  objective: string,
  tokenId: string,
  agentId: AgentRole = 'rdc-debugger'
): EvidenceEvent {
  return {
    eventId: randomUUID(),
    eventType: 'dispatch',
    agentId,
    status: 'sent',
    timestamp: Date.now(),
    payload: {
      targetAgent,
      objective: objective.substring(0, 500), // 截断避免过大
      capabilityTokenId: tokenId,
      dispatchTime: new Date().toISOString(),
      runId: state.runId,
      sessionId: state.sessionId,
    },
  };
}

/** 记录 Specialist 完成事件 */
export function createSpecialistCompleteEvidence(
  state: { sessionId: string; runId: string },
  agentId: AgentRole,
  brief: string,
  artifacts: string[]
): EvidenceEvent {
  return {
    eventId: randomUUID(),
    eventType: 'specialist_complete',
    agentId,
    status: 'ok',
    timestamp: Date.now(),
    payload: {
      brief: brief.substring(0, 500),
      artifacts,
      completedAt: new Date().toISOString(),
      runId: state.runId,
      sessionId: state.sessionId,
    },
  };
}

/** 从 GraphState 投影到 IPC WorkflowState */
export function projectToWorkflowState(graphState: GraphState): WorkflowState {
  return {
    caseId: graphState.caseId,
    runId: graphState.runId,
    sessionId: graphState.sessionId,
    currentStage: graphState.currentStage,
    previousStages: graphState.stageHistory,
    entryMode: graphState.entryMode,
    backend: graphState.backend,
    orchestrationMode: graphState.orchestrationMode,
    coordinationMode: graphState.coordinationMode,
    blockers: graphState.blockers,
    lastUpdated: graphState.lastUpdated,
  };
}

/** 检查是否应该进入阻断状态 */
export function checkBlockers(state: GraphState): boolean {
  return state.blockers.some(b => !b.resolvedAt);
}

/** 检查是否有未解决的 critical blocker */
export function hasCriticalBlocker(state: GraphState): boolean {
  return state.blockers.some(b => !b.resolvedAt && b.code.startsWith('BLOCKED_'));
}

/** 创建 Blocker */
export function createBlocker(
  code: string,
  reason: string,
  refs: string[] = []
): Blocker {
  return {
    code,
    reason,
    refs,
    detectedAt: new Date().toISOString(),
  };
}

/** 创建 SpecialistState 初始状态 */
export function createInitialSpecialistState(agentId: AgentRole): SpecialistState {
  return {
    agentId,
    status: 'pending',
    artifacts: [],
    retryCount: 0,
  };
}

/** 更新 Specialist 状态 */
export function updateSpecialistState(
  current: SpecialistState,
  updates: Partial<SpecialistState>
): SpecialistState {
  return {
    ...current,
    ...updates,
    // 保留 agentId 不被覆盖
    agentId: current.agentId,
  };
}

/** 创建工件 */
export function createArtifact(
  type: string,
  path: string,
  agentId: AgentRole
): Artifact {
  return {
    id: randomUUID(),
    type,
    path,
    agentId,
    createdAt: new Date().toISOString(),
  };
}

/** 获取当前 ISO 时间字符串 */
export function nowIso(): string {
  return new Date().toISOString();
}

export function ensureRunActive(runId: string): void {
  if (runExecutionService.isAbortRequested(runId)) {
    throw new Error(`Run aborted: ${runId}`);
  }
}

/** 获取当前毫秒时间戳 */
export function nowMs(): number {
  return Date.now();
}

/** 生成事件 ID */
export function generateEventId(prefix: string = 'evt'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/** 阶段转换映射（从 WorkflowEngine 迁移） */
export const STAGE_TRANSITIONS: Record<WorkflowStage, WorkflowStage[]> = {
  preflight: ['entry_gate'],
  entry_gate: ['intake_gate'],
  intake_gate: ['plan'],
  plan: ['speclist'],
  speclist: ['dispatch'],
  dispatch: ['investigate', 'blocked'],
  investigate: ['fix_verify', 'blocked'],
  fix_verify: ['skepti', 'blocked'],
  skepti: ['curate', 'fix_verify', 'blocked'],
  curate: ['finalize', 'blocked'],
  finalize: [],
  blocked: ['investigate', 'fix_verify'],
  awaiting_user_input: ['plan', 'dispatch'],
};

/** 获取下一个阶段 */
export function getNextStage(
  currentStage: WorkflowStage,
  preferred?: WorkflowStage
): WorkflowStage | null {
  const allowed = STAGE_TRANSITIONS[currentStage];
  if (!allowed || allowed.length === 0) return null;
  
  // 如果指定了首选且允许，返回首选
  if (preferred && allowed.includes(preferred)) {
    return preferred;
  }
  
  // 返回第一个非阻断阶段
  return allowed.find((s) => s !== 'blocked') || null;
}

/** 检查阶段转换是否允许 */
export function isTransitionAllowed(
  fromStage: WorkflowStage,
  toStage: WorkflowStage
): boolean {
  const allowed = STAGE_TRANSITIONS[fromStage];
  return allowed?.includes(toStage) ?? false;
}

export function resolveAgentRuntimeConfig(
  agentId: AgentRole,
  stageId: WorkflowStage,
): EffectiveAgentRuntimeConfig {
  const settings = settingsService.getAll();
  return executionProfileService.resolveAgentRuntimeProfile(settings, stageId, agentId);
}

export function resolveWorkflowPhase(stageId: WorkflowStage): WorkflowPhase {
  return resolveAgentRuntimeConfig('rdc-debugger', stageId).phase;
}

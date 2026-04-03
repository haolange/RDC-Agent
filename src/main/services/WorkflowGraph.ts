/**
 * WorkflowGraph.ts - LangGraph StateGraph 核心定义
 * 实现 12 阶段工作流状态机 + 受控回转机制
 */

import { BrowserWindow } from 'electron';
import { StateGraph, Annotation, START, END, interrupt, MemorySaver } from '@langchain/langgraph';
import type { BaseCheckpointSaver } from '@langchain/langgraph';
import type { DynamicStructuredTool } from '@langchain/core/tools';

import type {
  WorkflowStage,
  GraphState,
  SpecialistState,
  CaptureInfo,
  ReplaySession,
  Report,
} from '../../shared/types/workflow';

// 导入新 Session 类型（Task 1 已完成）
import type {
  CaptureDescriptor,
  DebugSessionStartRequest,
} from '@shared/types/session';
import type { ReplayDeviceEntry } from '@shared/types/device';
import type { ActionEvent } from '@shared/types/evidence';

// 导入 rdxSessionService（Task 2 已完成，单例在 index.ts）
import { rdxSessionService } from '../index';
import { storageAdapter } from './StorageAdapter';

// 导入节点函数
import { preflightNode, routeAfterPreflight } from './NodeFunctions/preflightNode';
import { intentGateNode, routeAfterIntentGate } from './NodeFunctions/intentGateNode';
import { entryGateNode, routeAfterEntryGate } from './NodeFunctions/entryGateNode';
import { intakeInitNode, routeAfterIntakeInit } from './NodeFunctions/intakeInitNode';
import { intakeGateNode, routeAfterIntakeGate } from './NodeFunctions/intakeGateNode';
import {
  specialistDispatchNode,
  createSpecialistSends,
} from './NodeFunctions/specialistDispatchNode';
import { specialistBriefsNode, routeAfterSpecialistBriefs } from './NodeFunctions/specialistBriefsNode';
import { expertInvestigationNode, routeAfterExpertInvestigation } from './NodeFunctions/expertInvestigationNode';
import { fixVerificationNode, routeAfterFixVerification } from './NodeFunctions/fixVerificationNode';
import { skepticNode, routeAfterSkeptic } from './NodeFunctions/skepticNode';
import { curatorNode, routeAfterCurator } from './NodeFunctions/curatorNode';
import { finalizeNode } from './NodeFunctions/finalizeNode';

// 导入 specialist 子图
import { createSpecialistSubgraph, type SpecialistSubgraphConfig } from './NodeFunctions/specialistSubgraph';

/** 工作流图配置 */
export interface WorkflowGraphConfig {
  /** 检查点保存器 */
  checkpointer?: BaseCheckpointSaver;
  /** Specialist 子图配置 */
  specialistConfig?: SpecialistSubgraphConfig;
  /** RDC 工具 */
  rdcTools?: DynamicStructuredTool[];
  /** 系统工具 */
  systemTools?: DynamicStructuredTool[];
  /** Skill 工具 */
  skillTools?: DynamicStructuredTool[];
}

// ============================================
// State Annotation 定义
// ============================================

/** 证据链事件 */
interface EvidenceEvent {
  eventId: string;
  eventType: string;
  agentId: string;
  status: string;
  timestamp: number;
  payload: Record<string, unknown>;
}

/** 工件 */
interface Artifact {
  id: string;
  type: string;
  path: string;
  agentId: string;
  createdAt: string;
}

/** 阻断器 */
interface BlockerState {
  code: string;
  reason: string;
  refs: string[];
  detectedAt: string;
  resolvedAt?: string;
}

/** Workflow State Annotation */
const WorkflowAnnotation = Annotation.Root({
  // 身份字段 - last-write-wins
  caseId: Annotation<string>({
    reducer: (_: string, b: string) => b,
    default: () => '',
  }),
  runId: Annotation<string>({
    reducer: (_: string, b: string) => b,
    default: () => '',
  }),
  sessionId: Annotation<string>({
    reducer: (_: string, b: string) => b,
    default: () => '',
  }),

  // 阶段字段 - last-write-wins
  currentStage: Annotation<WorkflowStage>({
    reducer: (_: WorkflowStage, b: WorkflowStage) => b,
    default: () => 'preflight_pending',
  }),
  stageHistory: Annotation<WorkflowStage[]>({
    reducer: (a: WorkflowStage[], b: WorkflowStage[]) => [...a, ...b],
    default: () => [],
  }),

  // 用户输入 - last-write-wins
  userGoal: Annotation<string>({
    reducer: (_: string, b: string) => b,
    default: () => '',
  }),
  capturePaths: Annotation<string[]>({
    reducer: (a: string[], b: string[]) => [...a, ...b],
    default: () => [],
  }),

  // === 新增 Session 相关字段（Task 4a）===
  /** 当前 run 的 captures 列表 */
  captures: Annotation<CaptureDescriptor[]>({
    reducer: (_: CaptureDescriptor[], b: CaptureDescriptor[]) => b,
    default: () => [],
  }),
  /** Primary capture ID */
  primaryCaptureId: Annotation<string>({
    reducer: (_: string, b: string) => b,
    default: () => '',
  }),
  /** 当前 Replay Device */
  replayDevice: Annotation<ReplayDeviceEntry | null>({
    reducer: (_: ReplayDeviceEntry | null, b: ReplayDeviceEntry | null) => b,
    default: () => null,
  }),
  /** 当前模式 */
  mode: Annotation<'debugger' | 'analyzer' | 'optimizer'>({
    reducer: (_: 'debugger' | 'analyzer' | 'optimizer', b: 'debugger' | 'analyzer' | 'optimizer') => b,
    default: () => 'debugger',
  }),
  /** 调试目标描述 */
  goal: Annotation<string>({
    reducer: (_: string, b: string) => b,
    default: () => '',
  }),

  // RDC 上下文 - last-write-wins
  captureInfo: Annotation<CaptureInfo | undefined>({
    reducer: (_: CaptureInfo | undefined, b: CaptureInfo | undefined) => b,
    default: () => undefined,
  }),
  replaySession: Annotation<ReplaySession | undefined>({
    reducer: (_: ReplaySession | undefined, b: ReplaySession | undefined) => b,
    default: () => undefined,
  }),

  // 证据链 - append reducer
  evidenceChain: Annotation<EvidenceEvent[]>({
    reducer: (a: EvidenceEvent[], b: EvidenceEvent[]) => [...a, ...b],
    default: () => [],
  }),

  // 工件 - append reducer
  artifacts: Annotation<Artifact[]>({
    reducer: (a: Artifact[], b: Artifact[]) => [...a, ...b],
    default: () => [],
  }),

  // Specialist 追踪 - merge reducer
  activeSpecialists: Annotation<Record<string, SpecialistState>>({
    reducer: (a: Record<string, SpecialistState>, b: Record<string, SpecialistState>) => ({ ...a, ...b }),
    default: () => ({}),
  }),
  pendingBriefs: Annotation<string[]>({
    reducer: (a: string[], b: string[]) => [...a, ...b],
    default: () => [],
  }),
  collectedBriefs: Annotation<Record<string, string>>({
    reducer: (a: Record<string, string>, b: Record<string, string>) => ({ ...a, ...b }),
    default: () => ({}),
  }),

  // 阻断/等待 - last-write-wins
  blockers: Annotation<BlockerState[]>({
    reducer: (a: BlockerState[], b: BlockerState[]) => [...a, ...b],
    default: () => [],
  }),
  interruptReason: Annotation<string | undefined>({
    reducer: (_: string | undefined, b: string | undefined) => b,
    default: () => undefined,
  }),

  // 回转追踪 - merge reducer
  backtrackCount: Annotation<Record<string, number>>({
    reducer: (a: Record<string, number>, b: Record<string, number>) => ({ ...a, ...b }),
    default: () => ({}),
  }),

  // 结果 - last-write-wins
  finalReport: Annotation<Report | undefined>({
    reducer: (_: Report | undefined, b: Report | undefined) => b,
    default: () => undefined,
  }),
  fixVerified: Annotation<boolean>({
    reducer: (_: boolean, b: boolean) => b,
    default: () => false,
  }),

  // 元数据 - last-write-wins
  entryMode: Annotation<'cli' | 'mcp'>({
    reducer: (_: 'cli' | 'mcp', b: 'cli' | 'mcp') => b,
    default: () => 'cli',
  }),
  backend: Annotation<'local' | 'remote'>({
    reducer: (_: 'local' | 'remote', b: 'local' | 'remote') => b,
    default: () => 'local',
  }),
  orchestrationMode: Annotation<'multi_agent'>({
    reducer: (_: 'multi_agent', b: 'multi_agent') => b,
    default: () => 'multi_agent',
  }),
  coordinationMode: Annotation<'staged_handoff'>({
    reducer: (_: 'staged_handoff', b: 'staged_handoff') => b,
    default: () => 'staged_handoff',
  }),
  lastUpdated: Annotation<string>({
    reducer: (_: string, b: string) => b,
    default: () => new Date().toISOString(),
  }),
});

/** Workflow State 类型 */
export type WorkflowStateType = typeof WorkflowAnnotation.State;

// 节点函数已从单独的文件导入，不再使用占位实现

/** Specialist Exec 节点（用于并行执行） */
async function specialistExecNode(
  _state: WorkflowStateType
): Promise<Partial<WorkflowStateType>> {
  // TODO: 实现 specialist 执行逻辑
  // 这将调用 specialist 子图
  return {};
}

// ============================================
// 条件路由函数
// ============================================

// ============================================
// 阻断/等待处理
// ============================================

/**
 * 三写辅助函数：同步写入 workflow graph state / workspace action chain / renderer event bus
 * 每个节点结果必须同步写入三处以确保状态一致性
 */
async function writeNodeResult(
  state: WorkflowStateType,
  event: Partial<ActionEvent>,
  channel: string,
  payload: unknown
): Promise<void> {
  // 1. action chain
  if (storageAdapter && state.runId) {
    const fullEvent: ActionEvent = {
      schema_version: '2',
      event_id: event.event_id ?? `evt-${Date.now()}`,
      ts_ms: event.ts_ms ?? Date.now(),
      run_id: state.runId,
      session_id: state.sessionId,
      agent_id: event.agent_id ?? 'rdc-debugger',
      event_type: event.event_type ?? 'workflow_stage_transition',
      status: event.status ?? 'ok',
      duration_ms: event.duration_ms ?? 0,
      refs: event.refs ?? [],
      payload: event.payload ?? {},
    };
    await storageAdapter.appendActionEvent(state.sessionId, fullEvent);
  }

  // 2. renderer broadcast
  const win = BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, payload);
  }
}

/**
 * 初始化 Workflow 状态
 * 从 DebugSessionStartRequest 填入 captures/primaryCaptureId/replayDevice/mode/goal
 */
export async function initializeWorkflowState(
  request: DebugSessionStartRequest
): Promise<Partial<WorkflowStateType>> {
  // 调用 rdxSessionService.bootstrap 进行完整初始化
  await rdxSessionService.bootstrap(request);

  return {
    captures: request.captures,
    primaryCaptureId: request.primaryCaptureId,
    replayDevice: request.replayDevice,
    mode: request.mode,
    goal: request.goal,
    userGoal: request.goal, // 兼容旧字段
    capturePaths: request.captures.map(c => c.filePath),
  };
}

/** Validation Blocked 节点 - 使用 interrupt */
function validationBlockedNode(state: WorkflowStateType): Partial<WorkflowStateType> {
  const unresolvedBlockers = state.blockers.filter((b: BlockerState) => !b.resolvedAt);
  
  // 使用 LangGraph interrupt 暂停执行
  interrupt({
    type: 'validation_blocked',
    blockers: unresolvedBlockers,
    currentStage: state.currentStage,
    message: `Workflow blocked with ${unresolvedBlockers.length} unresolved blockers`,
  });

  return {};
}

/** Awaiting User Input 节点 - 使用 interrupt */
function awaitingUserInputNode(state: WorkflowStateType): Partial<WorkflowStateType> {
  interrupt({
    type: 'awaiting_user_input',
    reason: state.interruptReason || 'User input required',
    currentStage: state.currentStage,
  });

  return {};
}

// ============================================
// 图构建函数
// ============================================

/**
 * 创建工作流图
 */
export function createWorkflowGraph(config: WorkflowGraphConfig = {}) {
  // 创建 specialist 子图（如果配置提供）
  if (config.specialistConfig) {
    createSpecialistSubgraph(config.specialistConfig);
  }

  // 创建节点函数包装器（适配 LangGraph 签名）
  const preflightNodeWrapper = (state: WorkflowStateType) => preflightNode(state as unknown as GraphState);
  const intentGateNodeWrapper = (state: WorkflowStateType) => intentGateNode(state as unknown as GraphState);
  const entryGateNodeWrapper = (state: WorkflowStateType) => entryGateNode(state as unknown as GraphState);
  const intakeInitNodeWrapper = (state: WorkflowStateType) => intakeInitNode(state as unknown as GraphState);
  const intakeGateNodeWrapper = (state: WorkflowStateType) => intakeGateNode(state as unknown as GraphState);
  const specialistDispatchNodeWrapper = (state: WorkflowStateType) => specialistDispatchNode(state as unknown as GraphState);
  const specialistBriefsNodeWrapper = (state: WorkflowStateType) => specialistBriefsNode(state as unknown as GraphState);
  const expertInvestigationNodeWrapper = (state: WorkflowStateType) => expertInvestigationNode(state as unknown as GraphState);
  const fixVerificationNodeWrapper = (state: WorkflowStateType) => fixVerificationNode(state as unknown as GraphState);
  const skepticNodeWrapper = (state: WorkflowStateType) => skepticNode(state as unknown as GraphState);
  const curatorNodeWrapper = (state: WorkflowStateType) => curatorNode(state as unknown as GraphState);
  const finalizeNodeWrapper = (state: WorkflowStateType) => finalizeNode(state as unknown as GraphState);

  // 构建主图
  const graph = new StateGraph(WorkflowAnnotation)
    // 添加主阶段节点
    .addNode('preflight', preflightNodeWrapper)
    .addNode('intent_gate', intentGateNodeWrapper)
    .addNode('entry_gate', entryGateNodeWrapper)
    .addNode('intake_init', intakeInitNodeWrapper)
    .addNode('intake_gate', intakeGateNodeWrapper)
    .addNode('specialist_dispatch', specialistDispatchNodeWrapper)
    .addNode('specialist_briefs', specialistBriefsNodeWrapper)
    .addNode('expert_investigation', expertInvestigationNodeWrapper)
    .addNode('fix_verification', fixVerificationNodeWrapper)
    .addNode('skeptic', skepticNodeWrapper)
    .addNode('curator', curatorNodeWrapper)
    .addNode('finalize', finalizeNodeWrapper)
    // 添加阻断/等待节点
    .addNode('validation_blocked', validationBlockedNode)
    .addNode('awaiting_user_input', awaitingUserInputNode)
    // 添加 specialist 执行节点（用于并行分派）
    .addNode('specialist_exec', specialistExecNode);

  // 定义边
  graph.addEdge(START, 'preflight');

  // 条件边：每个阶段后检查阻断
  graph.addConditionalEdges('preflight', (state: WorkflowStateType) => {
    const route = routeAfterPreflight(state as unknown as GraphState);
    return route === 'validation_blocked' ? 'validation_blocked' : 'intent_gate';
  });

  graph.addConditionalEdges('intent_gate', (state: WorkflowStateType) => {
    const route = routeAfterIntentGate(state as unknown as GraphState);
    return route === 'validation_blocked' ? 'validation_blocked' : 'entry_gate';
  });

  graph.addConditionalEdges('entry_gate', (state: WorkflowStateType) => {
    const route = routeAfterEntryGate(state as unknown as GraphState);
    return route === 'validation_blocked' ? 'validation_blocked' : 'intake_init';
  });

  graph.addConditionalEdges('intake_init', (state: WorkflowStateType) => {
    const route = routeAfterIntakeInit(state as unknown as GraphState);
    return route === 'validation_blocked' ? 'validation_blocked' : 'intake_gate';
  });

  graph.addConditionalEdges('intake_gate', (state: WorkflowStateType) => {
    const route = routeAfterIntakeGate(state as unknown as GraphState);
    return route === 'validation_blocked' ? 'validation_blocked' : 'specialist_dispatch';
  });

  // Specialist dispatch 使用 Send 并行分派
  graph.addConditionalEdges('specialist_dispatch', (state: WorkflowStateType) => {
    const sends = createSpecialistSends(state as unknown as GraphState);
    return sends;
  });

  // 其他条件边
  graph.addConditionalEdges('specialist_briefs', (state: WorkflowStateType) => routeAfterSpecialistBriefs(state as unknown as GraphState));
  graph.addConditionalEdges('expert_investigation', (state: WorkflowStateType) => routeAfterExpertInvestigation(state as unknown as GraphState));
  graph.addConditionalEdges('fix_verification', (state: WorkflowStateType) => routeAfterFixVerification(state as unknown as GraphState));
  graph.addConditionalEdges('skeptic', (state: WorkflowStateType) => routeAfterSkeptic(state as unknown as GraphState));
  graph.addConditionalEdges('curator', (state: WorkflowStateType) => routeAfterCurator(state as unknown as GraphState));

  // 阻断/等待节点的边
  graph.addConditionalEdges('validation_blocked', (state: WorkflowStateType) => {
    // 检查阻断是否已解决
    const hasUnresolved = state.blockers.some((b: BlockerState) => !b.resolvedAt);
    return hasUnresolved ? END : state.currentStage;
  });

  graph.addConditionalEdges('awaiting_user_input', (state: WorkflowStateType) => {
    // 检查是否已恢复
    return state.interruptReason ? END : state.currentStage;
  });

  // Specialist exec 返回 specialist_briefs
  graph.addEdge('specialist_exec', 'specialist_briefs');

  // 最终边
  graph.addEdge('finalize', END);

  // 编译图
  return graph.compile({
    checkpointer: config.checkpointer || new MemorySaver(),
  });
}

// ============================================
// 导出
// ============================================

export {
  WorkflowAnnotation,
  preflightNode,
  intentGateNode,
  entryGateNode,
  intakeInitNode,
  intakeGateNode,
  specialistDispatchNode,
  specialistBriefsNode,
  expertInvestigationNode,
  fixVerificationNode,
  skepticNode,
  curatorNode,
  finalizeNode,
  createSpecialistSubgraph,
  // 新增导出（Task 4a）
  writeNodeResult,
};

export type { SpecialistSubgraphConfig };


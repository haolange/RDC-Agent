import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { BrowserWindow } from 'electron';
import { Annotation, END, MemorySaver, START, StateGraph, interrupt } from '@langchain/langgraph';
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
import type { AppMode, CaptureDescriptor, DebugSessionStartRequest } from '@shared/types/session';
import type { ReplayDeviceEntry } from '@shared/types/device';
import type { ActionEvent } from '@shared/types/evidence';
import type { AgentRole } from '@shared/types/agent';
import { rdxSessionService } from '../index';
import { storageAdapter } from './StorageAdapter';
import { agentOrchestrator } from './AgentOrchestrator';
import { runExecutionService } from './RunExecutionService';
import { preflightNode, routeAfterPreflight } from './NodeFunctions/preflightNode';
import { entryGateNode, routeAfterEntryGate } from './NodeFunctions/entryGateNode';
import { intakeGateNode, routeAfterIntakeGate } from './NodeFunctions/intakeGateNode';
import { intentGateNode, routeAfterIntentGate } from './NodeFunctions/intentGateNode';
import { intakeInitNode, routeAfterIntakeInit } from './NodeFunctions/intakeInitNode';
import { specialistDispatchNode } from './NodeFunctions/specialistDispatchNode';
import { specialistBriefsNode, routeAfterSpecialistBriefs } from './NodeFunctions/specialistBriefsNode';
import { expertInvestigationNode, routeAfterExpertInvestigation } from './NodeFunctions/expertInvestigationNode';
import { fixVerificationNode, routeAfterFixVerification } from './NodeFunctions/fixVerificationNode';
import { skepticNode, routeAfterSkeptic } from './NodeFunctions/skepticNode';
import { curatorNode, routeAfterCurator } from './NodeFunctions/curatorNode';
import { finalizeNode } from './NodeFunctions/finalizeNode';
import {
  createArtifact,
  createSpecialistCompleteEvidence,
  createStageTransitionEvidence,
  ensureRunActive,
  nowIso,
  projectToWorkflowState,
} from './NodeFunctions/utils';

export interface WorkflowGraphConfig {
  checkpointer?: BaseCheckpointSaver;
  specialistConfig?: unknown;
  rdcTools?: DynamicStructuredTool[];
  systemTools?: DynamicStructuredTool[];
  skillTools?: DynamicStructuredTool[];
}

interface EvidenceEvent {
  eventId: string;
  eventType: string;
  agentId: string;
  status: string;
  timestamp: number;
  payload: Record<string, unknown>;
}

interface Artifact {
  id: string;
  type: string;
  path: string;
  agentId: string;
  createdAt: string;
}

interface BlockerState {
  code: string;
  reason: string;
  refs: string[];
  detectedAt: string;
  resolvedAt?: string;
}

const WorkflowAnnotation = Annotation.Root({
  caseId: Annotation<string>({ reducer: (_a, b) => b, default: () => '' }),
  runId: Annotation<string>({ reducer: (_a, b) => b, default: () => '' }),
  sessionId: Annotation<string>({ reducer: (_a, b) => b, default: () => '' }),
  currentStage: Annotation<WorkflowStage>({ reducer: (_a, b) => b, default: () => 'preflight' }),
  stageHistory: Annotation<WorkflowStage[]>({ reducer: (a, b) => [...a, ...b], default: () => [] }),
  userGoal: Annotation<string>({ reducer: (_a, b) => b, default: () => '' }),
  capturePaths: Annotation<string[]>({ reducer: (_a, b) => b, default: () => [] }),
  captures: Annotation<CaptureDescriptor[]>({ reducer: (_a, b) => b, default: () => [] }),
  primaryCaptureId: Annotation<string>({ reducer: (_a, b) => b, default: () => '' }),
  replayDevice: Annotation<ReplayDeviceEntry | null>({ reducer: (_a, b) => b, default: () => null }),
  mode: Annotation<AppMode>({ reducer: (_a, b) => b, default: () => 'debugger' }),
  goal: Annotation<string>({ reducer: (_a, b) => b, default: () => '' }),
  captureInfo: Annotation<CaptureInfo | undefined>({ reducer: (_a, b) => b, default: () => undefined }),
  replaySession: Annotation<ReplaySession | undefined>({ reducer: (_a, b) => b, default: () => undefined }),
  evidenceChain: Annotation<EvidenceEvent[]>({ reducer: (a, b) => [...a, ...b], default: () => [] }),
  artifacts: Annotation<Artifact[]>({ reducer: (a, b) => [...a, ...b], default: () => [] }),
  activeSpecialists: Annotation<Record<string, SpecialistState>>({ reducer: (a, b) => ({ ...a, ...b }), default: () => ({}) }),
  pendingBriefs: Annotation<string[]>({ reducer: (_a, b) => b, default: () => [] }),
  collectedBriefs: Annotation<Record<string, string>>({ reducer: (a, b) => ({ ...a, ...b }), default: () => ({}) }),
  blockers: Annotation<BlockerState[]>({ reducer: (_a, b) => b, default: () => [] }),
  interruptReason: Annotation<string | undefined>({ reducer: (_a, b) => b, default: () => undefined }),
  backtrackCount: Annotation<Record<string, number>>({ reducer: (a, b) => ({ ...a, ...b }), default: () => ({}) }),
  finalReport: Annotation<Report | undefined>({ reducer: (_a, b) => b, default: () => undefined }),
  fixVerified: Annotation<boolean>({ reducer: (_a, b) => b, default: () => false }),
  entryMode: Annotation<'cli' | 'mcp'>({ reducer: (_a, b) => b, default: () => 'cli' }),
  backend: Annotation<'local' | 'remote'>({ reducer: (_a, b) => b, default: () => 'local' }),
  orchestrationMode: Annotation<'multi_agent'>({ reducer: (_a, b) => b, default: () => 'multi_agent' }),
  coordinationMode: Annotation<'staged_handoff'>({ reducer: (_a, b) => b, default: () => 'staged_handoff' }),
  lastUpdated: Annotation<string>({ reducer: (_a, b) => b, default: () => nowIso() }),
});

export type WorkflowStateType = typeof WorkflowAnnotation.State;

function mergeGraphState(state: WorkflowStateType, patch: Partial<WorkflowStateType>): WorkflowStateType {
  return {
    ...state,
    ...patch,
    stageHistory: patch.stageHistory ? [...state.stageHistory, ...patch.stageHistory] : state.stageHistory,
    evidenceChain: patch.evidenceChain ? [...state.evidenceChain, ...patch.evidenceChain] : state.evidenceChain,
    artifacts: patch.artifacts ? [...state.artifacts, ...patch.artifacts] : state.artifacts,
    activeSpecialists: patch.activeSpecialists ? { ...state.activeSpecialists, ...patch.activeSpecialists } : state.activeSpecialists,
    collectedBriefs: patch.collectedBriefs ? { ...state.collectedBriefs, ...patch.collectedBriefs } : state.collectedBriefs,
    pendingBriefs: patch.pendingBriefs ?? state.pendingBriefs,
    blockers: patch.blockers ?? state.blockers,
    backtrackCount: patch.backtrackCount ? { ...state.backtrackCount, ...patch.backtrackCount } : state.backtrackCount,
  };
}

async function persistNodePatch(state: WorkflowStateType, patch: Partial<WorkflowStateType>): Promise<void> {
  const evidenceEvents = Array.isArray(patch.evidenceChain) ? patch.evidenceChain : [];
  for (const event of evidenceEvents) {
    const actionEvent: ActionEvent = {
      schema_version: '2',
      event_id: event.eventId,
      ts_ms: event.timestamp,
      run_id: state.runId,
      session_id: state.sessionId,
      agent_id: event.agentId,
      event_type: event.eventType,
      status: ['ok', 'error', 'sent', 'pass', 'fail', 'blocked', 'entered', 'warning', 'timeout', 'completed'].includes(event.status)
        ? (event.status as ActionEvent['status'])
        : 'ok',
      duration_ms: 0,
      refs: [],
      payload: event.payload,
    };
    await storageAdapter.appendActionEvent(state.sessionId, actionEvent);
    const win = BrowserWindow.getAllWindows()[0];
    if (win && !win.isDestroyed()) {
      win.webContents.send('evidence:eventAdded', actionEvent);
    }
  }

  const nextState = mergeGraphState(state, patch);
  runExecutionService.updateStage(state.runId, nextState.currentStage);
  await storageAdapter.updateRun(state.caseId, state.runId, {
    lastStage: nextState.currentStage,
    runtime: {
      workflow_stage: nextState.currentStage,
    },
  });

  const win = BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) {
    win.webContents.send('workflow:stateChanged', projectToWorkflowState(nextState as unknown as GraphState));
    win.webContents.send('workflow:stageChanged', {
      stage: nextState.currentStage,
      blockers: nextState.blockers,
    });
  }
}

function wrapNode(
  nodeFn: (state: GraphState) => Promise<Partial<GraphState>>,
): (state: WorkflowStateType) => Promise<Partial<WorkflowStateType>> {
  return async (state: WorkflowStateType) => {
    ensureRunActive(state.runId);
    const patch = await nodeFn(state as unknown as GraphState);
    ensureRunActive(state.runId);
    await persistNodePatch(state, patch as Partial<WorkflowStateType>);
    return patch as Partial<WorkflowStateType>;
  };
}

async function blockedNode(state: WorkflowStateType): Promise<Partial<WorkflowStateType>> {
  const patch: Partial<WorkflowStateType> = {
    currentStage: 'blocked',
    stageHistory: [state.currentStage],
    evidenceChain: [
      createStageTransitionEvidence(
        { sessionId: state.sessionId, runId: state.runId, currentStage: state.currentStage },
        'blocked',
      ),
    ],
    lastUpdated: nowIso(),
  };

  await persistNodePatch(state, patch);
  interrupt({
    type: 'blocked',
    currentStage: state.currentStage,
    blockers: state.blockers.filter((blocker) => !blocker.resolvedAt),
  });

  return patch;
}

async function awaitingUserInputNode(state: WorkflowStateType): Promise<Partial<WorkflowStateType>> {
  const patch: Partial<WorkflowStateType> = {
    currentStage: 'awaiting_user_input',
    stageHistory: [state.currentStage],
    evidenceChain: [
      createStageTransitionEvidence(
        { sessionId: state.sessionId, runId: state.runId, currentStage: state.currentStage },
        'awaiting_user_input',
      ),
    ],
    lastUpdated: nowIso(),
  };

  await persistNodePatch(state, patch);
  interrupt({
    type: 'awaiting_user_input',
    currentStage: state.currentStage,
    reason: state.interruptReason || 'User input required',
  });

  return patch;
}

async function specialistExecNode(state: WorkflowStateType): Promise<Partial<WorkflowStateType>> {
  const activeSpecialists: Record<string, SpecialistState> = { ...state.activeSpecialists };
  const collectedBriefs: Record<string, string> = { ...state.collectedBriefs };
  const artifacts: Artifact[] = [];
  const evidenceChain: EvidenceEvent[] = [];

  const targets = Object.values(activeSpecialists)
    .filter((specialist) => (specialist.status === 'running' || specialist.status === 'pending') && specialist.objective);

  await Promise.all(targets.map(async (specialist) => {
    try {
      const response = await agentOrchestrator.sendMessage(
        specialist.agentId as AgentRole,
        specialist.objective as string,
        {
          caseId: state.caseId,
          runId: state.runId,
          sessionId: state.sessionId,
        },
        {
          signal: runExecutionService.getAbortSignal(state.runId) ?? undefined,
        },
      );

      const notePath = path.join(storageAdapter.getRunPath(state.caseId, state.runId), 'notes', `${specialist.agentId}.md`);
      fs.mkdirSync(path.dirname(notePath), { recursive: true });
      fs.writeFileSync(notePath, response, 'utf8');
      artifacts.push(createArtifact('specialist_brief', notePath, specialist.agentId as AgentRole) as Artifact);

      activeSpecialists[specialist.agentId] = {
        ...specialist,
        status: 'completed',
        brief: response,
        completedAt: nowIso(),
        artifacts: [...specialist.artifacts, notePath],
      };
      collectedBriefs[specialist.agentId] = response;
      evidenceChain.push(createSpecialistCompleteEvidence(
        { sessionId: state.sessionId, runId: state.runId },
        specialist.agentId as AgentRole,
        response,
        [notePath],
      ));
    } catch (error) {
      activeSpecialists[specialist.agentId] = {
        ...specialist,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      };
      evidenceChain.push({
        eventId: randomUUID(),
        eventType: 'specialist_failed',
        agentId: specialist.agentId,
        status: 'error',
        timestamp: Date.now(),
        payload: {
          error: error instanceof Error ? error.message : String(error),
          runId: state.runId,
          sessionId: state.sessionId,
        },
      });
    }
  }));

  const patch: Partial<WorkflowStateType> = {
    currentStage: 'dispatch',
    stageHistory: [state.currentStage],
    activeSpecialists,
    collectedBriefs,
    pendingBriefs: [],
    artifacts,
    evidenceChain,
    lastUpdated: nowIso(),
  };

  await persistNodePatch(state, patch);
  return patch;
}

export async function initializeWorkflowState(
  request: DebugSessionStartRequest,
): Promise<Partial<WorkflowStateType>> {
  await rdxSessionService.bootstrap(request);
  const captures = request.captures ?? [];

  return {
    captures,
    primaryCaptureId: request.primaryCaptureId,
    replayDevice: request.replayDevice,
    mode: request.mode,
    goal: request.goal,
    userGoal: request.goal,
    capturePaths: captures.map((capture) => capture.filePath),
  };
}

export function createWorkflowGraph(config: WorkflowGraphConfig = {}) {
  const graph = new StateGraph(WorkflowAnnotation)
    .addNode('preflight', wrapNode(preflightNode))
    .addNode('entry_gate', wrapNode(entryGateNode))
    .addNode('intake_gate', wrapNode(intakeGateNode))
    .addNode('plan', wrapNode(intentGateNode))
    .addNode('speclist', wrapNode(intakeInitNode))
    .addNode('dispatch', wrapNode(specialistDispatchNode))
    .addNode('specialist_exec', specialistExecNode)
    .addNode('specialist_briefs', wrapNode(specialistBriefsNode))
    .addNode('investigate', wrapNode(expertInvestigationNode))
    .addNode('fix_verify', wrapNode(fixVerificationNode))
    .addNode('skepti', wrapNode(skepticNode))
    .addNode('curate', wrapNode(curatorNode))
    .addNode('finalize', wrapNode(finalizeNode))
    .addNode('blocked', blockedNode)
    .addNode('awaiting_user_input', awaitingUserInputNode);

  graph.addEdge(START, 'preflight');
  graph.addConditionalEdges('preflight', (state: WorkflowStateType) => (
    routeAfterPreflight(state as unknown as GraphState) === 'blocked' ? 'blocked' : 'entry_gate'
  ));
  graph.addConditionalEdges('entry_gate', (state: WorkflowStateType) => (
    routeAfterEntryGate(state as unknown as GraphState) === 'blocked' ? 'blocked' : 'intake_gate'
  ));
  graph.addConditionalEdges('intake_gate', (state: WorkflowStateType) => (
    routeAfterIntakeGate(state as unknown as GraphState) === 'blocked' ? 'blocked' : 'plan'
  ));
  graph.addConditionalEdges('plan', (state: WorkflowStateType) => (
    routeAfterIntentGate(state as unknown as GraphState) === 'blocked' ? 'blocked' : 'speclist'
  ));
  graph.addConditionalEdges('speclist', (state: WorkflowStateType) => (
    routeAfterIntakeInit(state as unknown as GraphState) === 'blocked' ? 'blocked' : 'dispatch'
  ));
  graph.addEdge('dispatch', 'specialist_exec');
  graph.addEdge('specialist_exec', 'specialist_briefs');
  graph.addConditionalEdges('specialist_briefs', (state: WorkflowStateType) => {
    const route = routeAfterSpecialistBriefs(state as unknown as GraphState);
    if (route === 'blocked') return 'blocked';
    if (route === 'specialist_exec') return 'specialist_exec';
    return 'investigate';
  });
  graph.addConditionalEdges('investigate', (state: WorkflowStateType) => (
    routeAfterExpertInvestigation(state as unknown as GraphState) === 'blocked' ? 'blocked' : 'fix_verify'
  ));
  graph.addConditionalEdges('fix_verify', (state: WorkflowStateType) => {
    const route = routeAfterFixVerification(state as unknown as GraphState);
    if (route === 'blocked') return 'blocked';
    if (route === 'expert_investigation') return 'investigate';
    return 'skepti';
  });
  graph.addConditionalEdges('skepti', (state: WorkflowStateType) => {
    const route = routeAfterSkeptic(state as unknown as GraphState);
    if (route === 'blocked') return 'blocked';
    if (route === 'fix_verification') return 'fix_verify';
    return 'curate';
  });
  graph.addConditionalEdges('curate', (state: WorkflowStateType) => {
    const route = routeAfterCurator(state as unknown as GraphState);
    if (route === 'blocked') return 'blocked';
    return route === 'curator' ? 'curate' : 'finalize';
  });
  graph.addEdge('finalize', END);

  return graph.compile({
    checkpointer: config.checkpointer || new MemorySaver(),
  });
}

export {
  WorkflowAnnotation,
  preflightNode,
  entryGateNode,
  intakeGateNode,
  intentGateNode,
  intakeInitNode,
  specialistDispatchNode,
  specialistBriefsNode,
  expertInvestigationNode,
  fixVerificationNode,
  skepticNode,
  curatorNode,
  finalizeNode,
};

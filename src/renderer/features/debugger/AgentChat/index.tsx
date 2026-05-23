import React, { useDeferredValue, useEffect, useMemo, useRef } from 'react';
import type {
  AgentEdge,
  AgentNode,
  AgentNodeStatus,
  ArtifactPayload,
  EvidencePayload,
  GroupPayload,
  StepPayload,
  TimelineProjection,
  ToolCallPayload,
} from '@shared/types/agentTimeline';
import type { ConversationMessage } from '@shared/types/conversation';
import type { ActionEvent } from '@shared/types/evidence';
import type { AgentMode } from '@shared/types/layout';
import type { DebugPlan, ReasoningSummary, WorkflowState } from '@shared/types/workflow';
import type { HarnessTask } from '@shared/types/harness';
import { AGENT_DISPLAY_NAMES } from '@shared/constants/agents';
import { useSessionStore } from '../../../stores/sessionStore';
import { EmptyWorkbenchPrompt } from '../../../patterns/EmptyWorkbenchPrompt';
import { AgentMessageTimeline } from '../AgentMessageTimeline';
import { PlanApprovalCard } from '../PlanIntakePanel';
import './AgentChat.css';

const STICKY_SCROLL_THRESHOLD = 96;

interface ProjectionBuilder {
  projection: TimelineProjection;
  addNode: <TPayload>(node: AgentNode<TPayload>) => AgentNode<TPayload>;
  addChild: (parentId: string, childId: string, edgeType?: AgentEdge['type']) => void;
  addEdge: (edge: AgentEdge) => void;
}

interface TurnInput {
  turnId: string;
  messages: ConversationMessage[];
  userMessage?: ConversationMessage;
  assistantMessages: ConversationMessage[];
  runIds: string[];
  createdAt: number;
}

interface ToolSource {
  id: string;
  toolName: string;
  status: AgentNodeStatus;
  argumentsSummary: string;
  resultSummary: string;
  argumentsRaw?: unknown;
  resultRaw?: unknown;
  error?: string;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
}

const ASK_USER_TOOL_NAME = 'ui.ask_user_question';
const WORKFLOW_STATUS_MESSAGE_PATTERNS = [
  /^已进入执行前\s*intake/u,
  /^收到，执行前置条件/u,
  /^计划已批准/u,
  /^正在/u,
  /^我已经为你重建/u,
  /^本轮调试已停止/u,
  /^执行失败：/u,
] as const;

interface ArtifactSource {
  id: string;
  name: string;
  path?: string;
  mimeType?: string;
  sizeBytes?: number;
  artifactType: ArtifactPayload['artifactType'];
}

interface AssistantMessagePayload {
  diagnostic?: ConversationMessage['diagnostic'];
}

const sanitizeId = (value: string): string => value.replace(/[^a-zA-Z0-9_-]/g, '_');

const firstLine = (value: string | undefined, fallback: string): string => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return fallback;
  }
  return trimmed.split(/\r?\n/)[0] || fallback;
};

const formatJsonPreview = (value: unknown): string => {
  if (value === undefined || value === null || value === '') {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const statusFromMessage = (message: ConversationMessage | undefined): AgentNodeStatus => {
  if (!message?.status || message.status === 'complete') {
    return 'succeeded';
  }
  if (message.status === 'draft' || message.status === 'streaming') {
    return 'streaming';
  }
  if (message.status === 'error') {
    return 'failed';
  }
  if (message.status === 'stopped') {
    return 'cancelled';
  }
  return 'succeeded';
};

const statusFromEvent = (event: ActionEvent): AgentNodeStatus => {
  if (event.status === 'error' || event.status === 'fail' || event.status === 'timeout') {
    return 'failed';
  }
  if (event.status === 'blocked') {
    return 'blocked';
  }
  if (event.status === 'sent' || event.status === 'entered') {
    return 'running';
  }
  if (event.status === 'warning') {
    return 'partial_succeeded';
  }
  return 'succeeded';
};

const statusFromHarness = (status: HarnessTask['status']): AgentNodeStatus => {
  if (status === 'completed') {
    return 'succeeded';
  }
  if (status === 'in_progress') {
    return 'running';
  }
  if (status === 'blocked') {
    return 'blocked';
  }
  if (status === 'rejected') {
    return 'failed';
  }
  if (status === 'cancelled') {
    return 'cancelled';
  }
  return 'pending';
};

const aggregateStatus = (statuses: AgentNodeStatus[]): AgentNodeStatus => {
  if (statuses.length === 0) {
    return 'pending';
  }
  if (statuses.every((status) => status === 'succeeded' || status === 'skipped')) {
    return 'succeeded';
  }
  if (statuses.every((status) => status === 'failed' || status === 'blocked' || status === 'cancelled')) {
    return 'failed';
  }
  if (statuses.some((status) => status === 'failed' || status === 'blocked' || status === 'cancelled' || status === 'partial_succeeded')) {
    return 'partial_succeeded';
  }
  if (statuses.some((status) => status === 'running' || status === 'streaming' || status === 'waiting_tool' || status === 'merging')) {
    return 'running';
  }
  return 'pending';
};

const createBuilder = (id: string, turnId: string, runId: string | undefined, messages: ConversationMessage[]): ProjectionBuilder => {
  const projection: TimelineProjection = {
    id,
    turnId,
    runId,
    nodes: {},
    edges: {},
    rootNodeIds: [],
    sourceMessages: messages,
  };

  const addNode = <TPayload,>(node: AgentNode<TPayload>): AgentNode<TPayload> => {
    projection.nodes[node.id] = node as AgentNode;
    if (!node.parentId && !projection.rootNodeIds.includes(node.id)) {
      projection.rootNodeIds.push(node.id);
    }
    return node;
  };

  const addEdge = (edge: AgentEdge) => {
    projection.edges[edge.id] = edge;
  };

  const addChild = (parentId: string, childId: string, edgeType: AgentEdge['type'] = 'contains') => {
    const parent = projection.nodes[parentId];
    const child = projection.nodes[childId];
    if (!parent || !child) {
      return;
    }
    parent.children = [...(parent.children ?? []), childId];
    child.parentId = parentId;
    projection.rootNodeIds = projection.rootNodeIds.filter((idValue) => idValue !== childId);
    addEdge({
      id: `${parentId}-${edgeType}-${childId}`,
      type: edgeType,
      from: parentId,
      to: childId,
      createdAt: child.createdAt,
    });
  };

  return { projection, addNode, addChild, addEdge };
};

const groupMessagesByTurn = (messages: ConversationMessage[]): TurnInput[] => {
  const byTurn = new Map<string, TurnInput>();

  for (const message of messages) {
    const turnId = message.turnId || message.id;
    const current = byTurn.get(turnId) ?? {
      turnId,
      messages: [],
      assistantMessages: [],
      runIds: [],
      createdAt: message.createdAt,
    };

    current.messages.push(message);
    current.createdAt = Math.min(current.createdAt, message.createdAt);
    if (message.role === 'user' && !current.userMessage) {
      current.userMessage = message;
    }
    if (message.role === 'assistant') {
      current.assistantMessages.push(message);
    }
    if (message.runId && !current.runIds.includes(message.runId)) {
      current.runIds.push(message.runId);
    }
    byTurn.set(turnId, current);
  }

  return Array.from(byTurn.values())
    .map((turn) => ({
      ...turn,
      messages: turn.messages.slice().sort((left, right) => left.createdAt - right.createdAt),
      assistantMessages: turn.assistantMessages.slice().sort((left, right) => left.createdAt - right.createdAt),
    }))
    .sort((left, right) => left.createdAt - right.createdAt);
};

const collectTurnEvents = (turn: TurnInput, actionEvents: ActionEvent[]): ActionEvent[] => {
  const runIds = new Set(turn.runIds);
  const isSyntheticRunTurn = turn.messages.length === 0 && runIds.size > 0;
  return actionEvents
    .filter((event) => (
      event.turn_id === turn.turnId
      || ((!event.turn_id || isSyntheticRunTurn) && runIds.has(event.run_id))
    ))
    .sort((left, right) => left.ts_ms - right.ts_ms);
};

const collectToolSources = (turn: TurnInput, events: ActionEvent[]): ToolSource[] => {
  const tools: ToolSource[] = [];
  const eventToolNames = new Set(
    events
      .filter((entry) => entry.event_type === 'tool_execution')
      .map((entry) => String(entry.payload.tool_name || entry.payload.toolName || 'tool')),
  );

  const upsertTool = (tool: ToolSource) => {
    const existingIndex = tools.findIndex((entry) => entry.id === tool.id && entry.toolName === tool.toolName);
    if (existingIndex < 0) {
      tools.push(tool);
      return;
    }
    const existing = tools[existingIndex];
    tools[existingIndex] = {
      ...existing,
      ...tool,
      argumentsRaw: existing.argumentsRaw ?? tool.argumentsRaw,
      argumentsSummary: existing.argumentsSummary || tool.argumentsSummary,
      startedAt: Math.min(existing.startedAt, tool.startedAt),
      completedAt: tool.completedAt ?? existing.completedAt,
      durationMs: tool.durationMs ?? existing.durationMs,
    };
  };

  for (const message of turn.assistantMessages) {
    for (const step of message.reasoningTrace?.steps ?? []) {
      for (const toolCall of step.toolCalls) {
        if (eventToolNames.has(toolCall.toolName)) {
          continue;
        }
        upsertTool({
          id: `${message.id}-${toolCall.id}`,
          toolName: toolCall.toolName,
          status: toolCall.status === 'error' ? 'failed' : toolCall.status === 'running' ? 'running' : 'succeeded',
          argumentsSummary: toolCall.argsPreview || '{}',
          resultSummary: toolCall.error || toolCall.resultPreview || '工具调用已完成。',
          argumentsRaw: toolCall.argsPreview,
          resultRaw: toolCall.resultPreview,
          error: toolCall.error,
          startedAt: toolCall.startedAt,
          completedAt: toolCall.completedAt,
          durationMs: toolCall.completedAt ? toolCall.completedAt - toolCall.startedAt : undefined,
        });
      }
    }
  }

  for (const event of events.filter((entry) => entry.event_type === 'tool_execution')) {
    const toolName = String(event.payload.tool_name || event.payload.toolName || 'tool');
    if (toolName === ASK_USER_TOOL_NAME) {
      const promptId = String(event.payload.prompt_id || event.event_id);
      const questions = Array.isArray(event.payload.questions) ? event.payload.questions : [];
      const answers = Array.isArray(event.payload.answers) ? event.payload.answers : [];
      const questionCount = Number(event.payload.question_count || questions.length || 0);
      const isAnswer = String(event.payload.phase || '') === 'answer' || answers.length > 0;
      upsertTool({
        id: `ask-user-${promptId}`,
        toolName,
        status: isAnswer ? 'succeeded' : 'waiting_user',
        argumentsSummary: `已询问 ${Math.max(questionCount, 1)} 个问题`,
        resultSummary: isAnswer
          ? firstLine(String(event.payload.answerSummary || `已回答 ${answers.length} 个问题。`), '已回答用户问题。')
          : '等待用户选择。',
        argumentsRaw: {
          title: event.payload.title,
          summary: event.payload.summary,
          questions,
        },
        resultRaw: isAnswer
          ? {
              answers,
              answerSummary: event.payload.answerSummary,
            }
          : undefined,
        startedAt: event.ts_ms,
        completedAt: isAnswer ? event.ts_ms + event.duration_ms : undefined,
        durationMs: isAnswer ? event.duration_ms : undefined,
      });
      continue;
    }

    const error = event.status === 'error' || event.status === 'fail'
      ? formatJsonPreview(event.payload.error || event.payload.message || '工具调用失败。')
      : undefined;
    upsertTool({
      id: event.event_id,
      toolName,
      status: statusFromEvent(event),
      argumentsSummary: formatJsonPreview(event.payload.args ?? event.payload.arguments ?? {}),
      resultSummary: error || firstLine(formatJsonPreview(event.payload.data ?? event.payload.result), '工具调用已完成。'),
      argumentsRaw: event.payload.args ?? event.payload.arguments,
      resultRaw: event.payload.data ?? event.payload.result,
      error,
      startedAt: event.ts_ms,
      completedAt: event.ts_ms + event.duration_ms,
      durationMs: event.duration_ms,
    });
  }

  const seen = new Set<string>();
  return tools.filter((tool) => {
    const key = `${tool.id}:${tool.toolName}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

const looksLikePath = (value: string): boolean =>
  /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('/') || value.includes('\\') || value.includes('/');

const collectArtifactPathValues = (value: unknown, artifacts: ArtifactSource[], idPrefix: string) => {
  if (typeof value === 'string') {
    if (!looksLikePath(value)) {
      return;
    }
    const normalized = value.replace(/\\/g, '/');
    const name = normalized.split('/').filter(Boolean).pop() ?? value;
    const isImage = /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name);
    artifacts.push({
      id: `${idPrefix}-${artifacts.length}`,
      name,
      path: value,
      artifactType: isImage ? 'image' : 'file',
    });
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectArtifactPathValues(entry, artifacts, `${idPrefix}-${index}`));
    return;
  }

  if (!value || typeof value !== 'object') {
    return;
  }

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (/path|file|artifact|image|screenshot|report|markdown|html/i.test(key)) {
      collectArtifactPathValues(entry, artifacts, `${idPrefix}-${key}`);
    }
  }
};

const collectArtifactSources = (turn: TurnInput, events: ActionEvent[]): ArtifactSource[] => {
  const artifacts: ArtifactSource[] = [];

  for (const message of turn.messages) {
    for (const attachment of message.attachments ?? []) {
      artifacts.push({
        id: attachment.attachmentId,
        name: attachment.fileName,
        path: attachment.filePath,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.size,
        artifactType: attachment.kind === 'image' ? 'image' : 'file',
      });
    }
  }

  for (const event of events) {
    collectArtifactPathValues(event.payload, artifacts, event.event_id);
  }

  const seen = new Set<string>();
  return artifacts.filter((artifact) => {
    const key = artifact.path || artifact.name;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

const collectReasoningSummaries = (
  runId: string | undefined,
  workflowState: WorkflowState | null,
): ReasoningSummary[] => {
  if (!runId || workflowState?.runId !== runId) {
    return [];
  }
  return workflowState.reasoningSummaries ?? [];
};

const collectHarnessTasks = (
  runId: string | undefined,
  workflowState: WorkflowState | null,
): HarnessTask[] => {
  if (!runId || workflowState?.runId !== runId) {
    return [];
  }
  return workflowState.harnessTasks ?? [];
};

const createToolNode = (
  builder: ProjectionBuilder,
  tool: ToolSource,
  idPrefix: string,
  order: number,
  parentId?: string,
): AgentNode<ToolCallPayload> => {
  const node = builder.addNode<ToolCallPayload>({
    id: `${idPrefix}-tool-${sanitizeId(tool.id)}`,
    type: 'tool_call',
    status: tool.status,
    title: tool.toolName,
    summary: firstLine(tool.resultSummary, '工具调用已完成。'),
    parentId,
    runId: builder.projection.runId,
    turnId: builder.projection.turnId,
    order,
    createdAt: tool.startedAt,
    completedAt: tool.completedAt,
    expandable: true,
    defaultExpanded: tool.status === 'failed' || tool.status === 'blocked',
    metrics: {
      durationMs: tool.durationMs,
    },
    payload: {
      toolName: tool.toolName,
      toolType: 'custom',
      purpose: '执行外部能力并把结果回投到消息流。',
      argumentsSummary: tool.argumentsSummary,
      argumentsRaw: tool.argumentsRaw,
      resultSummary: tool.resultSummary,
      resultRaw: tool.resultRaw,
      stderr: tool.error,
    },
  });
  if (parentId) {
    builder.addChild(parentId, node.id);
  }
  return node;
};

const isContextToolSource = (tool: ToolSource): boolean => {
  const name = tool.toolName.toLowerCase();
  return /(^|[._:-])(read|grep|glob|search|list|ls|context|context_snapshot|snapshot)([._:-]|$)/.test(name)
    || name.includes('web.search')
    || name.includes('web_search');
};

const contextToolLabel = (tools: ToolSource[]): { title: string; summary: string } => {
  const names = tools.map((tool) => tool.toolName.toLowerCase());
  const rawText = tools.map((tool) => `${formatJsonPreview(tool.argumentsRaw)}\n${tool.resultSummary}`).join('\n').toLowerCase();
  const readCount = names.filter((name) => name.includes('read')).length;
  const searchCount = names.filter((name) => name.includes('search') || name.includes('grep') || name.includes('glob')).length;
  const listCount = names.filter((name) => name.includes('list') || /(^|[._:-])ls([._:-]|$)/.test(name)).length;
  const summary = tools[tools.length - 1]?.resultSummary || '上下文收集工具已完成。';

  if (/taxonomy|invariant|sop|bugcard|knowledge/.test(rawText)) {
    return { title: 'Explored taxonomy resources', summary };
  }
  if (readCount === tools.length) {
    return { title: `Reviewed ${tools.length} files`, summary };
  }
  if (searchCount === tools.length) {
    return { title: `Searched ${tools.length} times`, summary };
  }
  if (listCount === tools.length) {
    return { title: `Reviewed ${tools.length} directories`, summary };
  }
  return { title: `Reviewed ${tools.length} resources`, summary };
};

const hasReasoningTrace = (message: ConversationMessage): boolean =>
  Boolean(message.reasoningTrace?.steps.some((step) => (
    step.summary
    || step.detail
    || step.toolCalls.length > 0
    || step.status === 'running'
    || step.status === 'error'
  )));

const isCoworkReasoningMessage = (message: ConversationMessage): boolean => {
  const steps = message.reasoningTrace?.steps ?? [];
  return !message.runId && steps.length > 0 && steps.every((step) => step.id.startsWith('cowork-'));
};

const isCoworkOnlyTrace = (
  turn: TurnInput,
  actualRunId: string | undefined,
  events: ActionEvent[],
): boolean => (
  !actualRunId
  && events.length === 0
  && turn.assistantMessages.some(isCoworkReasoningMessage)
  && turn.assistantMessages.every((message) => !hasReasoningTrace(message) || isCoworkReasoningMessage(message))
);

const collectReasoningSteps = (turn: TurnInput): Array<{
  messageId: string;
  stepId: string;
  title: string;
  status: AgentNodeStatus;
  summary?: string;
  detail?: string;
  stage?: string;
  startedAt: number;
  completedAt?: number;
}> => {
  const steps: Array<{
    messageId: string;
    stepId: string;
    title: string;
    status: AgentNodeStatus;
    summary?: string;
    detail?: string;
    stage?: string;
    startedAt: number;
    completedAt?: number;
  }> = [];

  for (const message of turn.assistantMessages) {
    for (const step of message.reasoningTrace?.steps ?? []) {
      steps.push({
        messageId: message.id,
        stepId: step.id,
        title: step.title,
        status: step.status === 'error'
          ? 'failed'
          : step.status === 'running'
            ? 'running'
            : step.status === 'pending'
              ? 'pending'
              : 'succeeded',
        summary: step.summary,
        detail: step.detail,
        stage: step.stage,
        startedAt: step.startedAt,
        completedAt: step.completedAt,
      });
    }
  }

  return steps.sort((left, right) => left.startedAt - right.startedAt);
};

const createGroupNode = (
  builder: ProjectionBuilder,
  id: string,
  title: string,
  summary: string,
  order: number,
  createdAt: number,
  groupType: GroupPayload['groupType'],
  status: AgentNodeStatus,
  parentId?: string,
): AgentNode<GroupPayload> => {
  const node = builder.addNode<GroupPayload>({
    id,
    type: 'group',
    status,
    title,
    summary,
    runId: builder.projection.runId,
    turnId: builder.projection.turnId,
    order,
    createdAt,
    expandable: true,
    defaultExpanded: false,
    payload: {
      groupType,
      strategy: 'collect',
      objective: summary,
    },
  });
  if (parentId) {
    builder.addChild(parentId, node.id);
  }
  return node;
};

const isWorkflowStatusAssistantMessage = (message: ConversationMessage): boolean => (
  message.role === 'assistant'
  && message.modeContext === 'debugger'
  && Boolean(message.runId)
  && WORKFLOW_STATUS_MESSAGE_PATTERNS.some((pattern) => pattern.test(message.content.trim()))
);

const isAskModeTurn = (turn: TurnInput): boolean => (
  !turn.runIds.length
  && turn.messages.some((message) => message.modeContext === 'ask')
  && turn.assistantMessages.length > 0
);

const isAskUserQuestionAnswerMessage = (
  message: ConversationMessage | undefined,
  actionEvents: ActionEvent[],
): boolean => {
  if (!message || message.role !== 'user' || message.modeContext !== 'debugger' || !message.runId) {
    return false;
  }
  if (!/^选择[:：]/u.test(message.content.trim())) {
    return false;
  }
  return actionEvents.some((event) => (
    event.run_id === message.runId
    && event.event_type === 'tool_execution'
    && String(event.payload.tool_name || event.payload.toolName) === ASK_USER_TOOL_NAME
    && String(event.payload.phase || '') === 'answer'
    && Math.abs(event.ts_ms - message.createdAt) <= 120_000
  ));
};


const buildTraceProjection = (
  turn: TurnInput,
  actionEvents: ActionEvent[],
  workflowState: WorkflowState | null,
  currentDebugPlan: DebugPlan | null,
): TimelineProjection => {
  const events = collectTurnEvents(turn, actionEvents);
  const actualRunId = turn.runIds[0] ?? events[0]?.run_id;
  const runId = actualRunId ?? `turn-${sanitizeId(turn.turnId)}`;
  const builder = createBuilder(`projection-${sanitizeId(turn.turnId)}`, turn.turnId, runId, turn.messages);
  const baseTime = turn.createdAt;
  const assistantStatus = aggregateStatus(turn.assistantMessages.map(statusFromMessage));
  const coworkTrace = isCoworkOnlyTrace(turn, actualRunId, events);
  const latestDiagnostic = turn.assistantMessages
    .slice()
    .reverse()
    .find((message) => message.diagnostic)?.diagnostic ?? null;

  if (turn.userMessage && !isAskUserQuestionAnswerMessage(turn.userMessage, actionEvents)) {
    builder.addNode({
      id: `${turn.turnId}-user`,
      type: 'user_message',
      status: 'succeeded',
      title: 'User Message',
      summary: turn.userMessage.content,
      turnId: turn.turnId,
      order: 1,
      createdAt: turn.userMessage.createdAt,
    });
  }

  const toolSources = collectToolSources(turn, events);
  const artifactSources = collectArtifactSources(turn, events);
  const reasoningSteps = collectReasoningSteps(turn);
  const reasoningSummaries = collectReasoningSummaries(actualRunId, workflowState);
  const harnessTasks = collectHarnessTasks(actualRunId, workflowState);
  const workflowStatusMessages = turn.assistantMessages.filter(isWorkflowStatusAssistantMessage);
  const plan = actualRunId
    ? (workflowState?.runId === actualRunId ? (workflowState.debugPlan ?? currentDebugPlan) : currentDebugPlan)
    : undefined;
  const traceMessages = turn.assistantMessages.filter(hasReasoningTrace);
  const askModeTurn = isAskModeTurn(turn);
  const hasTraceDetails = Boolean(
    askModeTurn
    || traceMessages.length > 0
    || events.length > 0
    || toolSources.length > 0
    || artifactSources.length > 0
    || reasoningSummaries.length > 0
    || harnessTasks.length > 0
    || workflowStatusMessages.length > 0
    || plan?.blockers?.length
    || plan?.missingInfo?.length
  );

  if (hasTraceDetails) {
    const traceStatus = coworkTrace
      ? latestDiagnostic?.code === 'CONVERSATION_LLM_ROUTE_MISSING'
        ? 'blocked'
        : assistantStatus
      : aggregateStatus([
          assistantStatus,
          ...events.map(statusFromEvent),
          ...reasoningSteps.map((step) => step.status),
          ...harnessTasks.map((task) => statusFromHarness(task.status)),
          ...workflowStatusMessages.map(statusFromMessage),
        ]);
    const traceBaseTime = traceMessages[0]?.reasoningTrace?.updatedAt
      ?? events[0]?.ts_ms
      ?? turn.assistantMessages[0]?.createdAt
      ?? baseTime;

    if (askModeTurn) {
      builder.addNode<StepPayload>({
        id: `${turn.turnId}-ask-activity`,
        type: 'step',
        status: traceStatus,
        title: 'Ask 活动',
        summary: latestDiagnostic?.userMessage ?? '检查当前工作台状态并生成回复。',
        runId,
        turnId: turn.turnId,
        order: 2,
        createdAt: traceBaseTime,
        completedAt: turn.assistantMessages[turn.assistantMessages.length - 1]?.updatedAt ?? traceBaseTime,
        ui: {
          density: 'compact',
        },
        payload: {
          objective: 'Ask 只做澄清、解释和引导，不启动 RenderDoc 执行链。',
          actualOutput: '生成普通问答回复。',
        },
      });
    }

    workflowStatusMessages.forEach((message, index) => {
      const nodeId = `${turn.turnId}-workflow-status-${sanitizeId(message.id)}`;
      builder.addNode<StepPayload>({
        id: nodeId,
        type: 'step',
        status: statusFromMessage(message),
        title: '工作流状态',
        summary: firstLine(message.content, '工作流状态已更新。'),
        runId,
        turnId: turn.turnId,
        order: 2.1 + index / 100,
        createdAt: message.createdAt,
        completedAt: message.updatedAt ?? message.createdAt,
        payload: {
          objective: '收敛本轮 Debugger 状态，不作为普通 assistant 回复展示。',
          actualOutput: message.content,
        },
      });
    });

    if (reasoningSteps.length > 0 || reasoningSummaries.length > 0 || events.some((event) => event.event_type !== 'tool_execution')) {
      const thinkingGroup = createGroupNode(
        builder,
        `${turn.turnId}-thinking-group`,
        actualRunId ? 'Agent 活动' : 'Ask 活动',
        actualRunId ? '本轮运行状态和高层活动摘要。' : '本轮 Ask 高层活动摘要。',
        2.2,
        reasoningSteps[0]?.startedAt ?? events[0]?.ts_ms ?? traceBaseTime,
        'section_group',
        aggregateStatus([
          ...reasoningSteps.map((step) => step.status),
          ...events.filter((event) => event.event_type !== 'tool_execution').map(statusFromEvent),
          ...reasoningSummaries.map(() => 'succeeded' as const),
        ]),
      );

      reasoningSteps.forEach((step, index) => {
        const nodeId = `${turn.turnId}-reasoning-${sanitizeId(step.messageId)}-${sanitizeId(step.stepId)}`;
        builder.addNode<StepPayload>({
          id: nodeId,
          type: 'step',
          status: step.status,
          title: step.title,
          summary: step.summary ?? step.detail ?? step.stage,
          runId,
          turnId: turn.turnId,
            order: index + 1,
            createdAt: step.startedAt,
          completedAt: step.completedAt,
          payload: {
            objective: step.title,
            actualOutput: step.detail,
          },
        });
        builder.addChild(thinkingGroup.id, nodeId);
      });

      reasoningSummaries.forEach((summary, index) => {
        const nodeId = `${turn.turnId}-summary-${sanitizeId(summary.summaryId)}`;
        builder.addNode<StepPayload>({
          id: nodeId,
          type: 'step',
          status: 'succeeded',
          title: AGENT_DISPLAY_NAMES[summary.agentId] ?? summary.agentId,
          summary: summary.summary,
          runId,
          turnId: turn.turnId,
            order: reasoningSteps.length + index + 1,
            createdAt: Date.parse(summary.createdAt) || traceBaseTime,
          payload: {
            objective: summary.stage,
            actualOutput: summary.nextStep,
          },
        });
        builder.addChild(thinkingGroup.id, nodeId);
      });

      events
        .filter((event) => event.event_type !== 'tool_execution')
        .forEach((event, index) => {
          const nodeId = `${turn.turnId}-event-${sanitizeId(event.event_id)}`;
          builder.addNode<StepPayload>({
            id: nodeId,
            type: 'step',
            status: statusFromEvent(event),
            title: event.agent_id ? `${event.agent_id} · ${event.event_type}` : event.event_type,
            summary: firstLine(formatJsonPreview(event.payload.summary ?? event.payload.message ?? event.payload.reason ?? event.payload), event.event_type),
            runId,
            turnId: turn.turnId,
            order: reasoningSteps.length + reasoningSummaries.length + index + 1,
            createdAt: event.ts_ms,
            completedAt: event.ts_ms + event.duration_ms,
            payload: {
              objective: event.event_type,
              actualOutput: formatJsonPreview(event.payload),
            },
          });
          builder.addChild(thinkingGroup.id, nodeId);
        });
    }

    if (toolSources.length > 0) {
      let toolIndex = 0;
      let order = 3;
      while (toolIndex < toolSources.length) {
        const contextRun: ToolSource[] = [];
        while (toolIndex < toolSources.length && isContextToolSource(toolSources[toolIndex])) {
          contextRun.push(toolSources[toolIndex]);
          toolIndex += 1;
        }

        if (contextRun.length >= 3) {
          const contextLabel = contextToolLabel(contextRun);
          const contextGroup = createGroupNode(
            builder,
            `${turn.turnId}-context-tools-${order}`,
            contextLabel.title,
            contextLabel.summary,
            order,
            contextRun[0].startedAt,
            'tool_group',
            aggregateStatus(contextRun.map((tool) => tool.status)),
          );
          contextGroup.defaultExpanded = false;
          contextRun.forEach((tool, index) => createToolNode(
            builder,
            tool,
            `${turn.turnId}-context-tool-${order}`,
            index + 1,
            contextGroup.id,
          ));
          order += 1;
          continue;
        }

        const directTools = contextRun.length > 0 ? contextRun : [toolSources[toolIndex]];
        if (contextRun.length === 0) {
          toolIndex += 1;
        }
        directTools.forEach((tool) => {
          createToolNode(builder, tool, `${turn.turnId}-tool`, order);
          order += 1;
        });
      }
    }

    if (plan?.missingInfo?.length || plan?.blockers?.length) {
      const questionGroup = createGroupNode(
        builder,
        `${turn.turnId}-question-group`,
        '需要用户确认',
        '来自计划缺口或阻塞状态。',
        5,
        traceBaseTime + 3,
        'section_group',
        aggregateStatus([
          ...(plan?.blockers?.length ? ['blocked' as const] : []),
        ]),
      );

      [...(plan?.missingInfo ?? []), ...(plan?.blockers?.map((blocker) => blocker.reason) ?? [])]
        .filter(Boolean)
        .forEach((entry, index) => {
          const nodeId = `${turn.turnId}-missing-${index}`;
          builder.addNode<StepPayload>({
            id: nodeId,
            type: 'step',
            status: 'blocked',
            title: '待确认',
            summary: entry,
            runId,
            turnId: turn.turnId,
            order: index + 1,
            createdAt: traceBaseTime + index + 1,
            payload: {
              objective: '等待用户补充信息。',
            },
          });
          builder.addChild(questionGroup.id, nodeId);
        });
    }

    if (toolSources.length > 0 || artifactSources.length > 0) {
      const evidenceGroup = createGroupNode(
        builder,
        `${turn.turnId}-evidence-group`,
        '证据',
        '本轮轨迹中可回溯的工具结果或产物来源。',
        6,
        traceBaseTime + 4,
        'evidence_group',
        'succeeded',
      );
      evidenceGroup.defaultExpanded = false;

      toolSources.slice(0, 6).forEach((tool, index) => {
        const evidenceNode = builder.addNode<EvidencePayload>({
          id: `${turn.turnId}-evidence-tool-${index + 1}`,
          type: 'evidence',
          status: tool.status === 'failed' ? 'partial_succeeded' : 'succeeded',
          title: tool.toolName,
          summary: tool.resultSummary,
          runId,
          turnId: turn.turnId,
          order: index + 1,
          createdAt: tool.completedAt ?? tool.startedAt,
          payload: {
            sourceNodeId: `${turn.turnId}-tool-tool-${sanitizeId(tool.id)}`,
            sourceType: 'tool_result',
            quote: tool.resultSummary,
            confidence: tool.status === 'succeeded' ? 0.86 : 0.58,
          },
        });
        builder.addChild(evidenceGroup.id, evidenceNode.id);
      });

      artifactSources.slice(0, 3).forEach((artifact, index) => {
        const evidenceNode = builder.addNode<EvidencePayload>({
          id: `${turn.turnId}-evidence-artifact-${index + 1}`,
          type: 'evidence',
          status: 'succeeded',
          title: artifact.name,
          summary: artifact.path ?? artifact.name,
          runId,
          turnId: turn.turnId,
          order: toolSources.length + index + 1,
          createdAt: traceBaseTime + 5 + index,
          payload: {
            sourceNodeId: `${turn.turnId}-artifact-${sanitizeId(artifact.id)}`,
            sourceType: 'artifact',
            quote: artifact.path ?? artifact.name,
            confidence: 0.8,
          },
        });
        builder.addChild(evidenceGroup.id, evidenceNode.id);
      });
    }

    if (artifactSources.length > 0) {
      const artifactGroup = createGroupNode(
        builder,
        `${turn.turnId}-artifact-group`,
        '产物',
        '本轮运行生成或引用的文件。',
        7,
        traceBaseTime + 5,
        'artifact_group',
        'succeeded',
      );
      artifactGroup.defaultExpanded = false;

      artifactSources.forEach((artifact, index) => {
        const artifactNode = builder.addNode<ArtifactPayload>({
          id: `${turn.turnId}-artifact-${sanitizeId(artifact.id)}`,
          type: 'artifact',
          status: 'succeeded',
          title: artifact.name,
          summary: artifact.path ?? artifact.name,
          runId,
          turnId: turn.turnId,
          order: index + 1,
          createdAt: traceBaseTime + index + 1,
          payload: {
            artifactType: artifact.artifactType,
            name: artifact.name,
            path: artifact.path,
            mimeType: artifact.mimeType,
            sizeBytes: artifact.sizeBytes,
          },
        });
        builder.addChild(artifactGroup.id, artifactNode.id);
      });
    }
  }

  turn.assistantMessages
    .filter((message) => message.content.trim().length > 0 && !isWorkflowStatusAssistantMessage(message))
    .forEach((message, index) => {
      builder.addNode<AssistantMessagePayload>({
        id: `${message.id}-assistant`,
        type: 'assistant_message',
        status: statusFromMessage(message),
        title: 'Assistant Message',
        summary: message.content,
        runId: message.runId ?? runId,
        turnId: turn.turnId,
        order: 3 + index,
        createdAt: message.createdAt,
        payload: {
          diagnostic: message.diagnostic ?? null,
        },
      });
    });

  return builder.projection;
};

const buildTimelineProjections = (
  messages: ConversationMessage[],
  actionEvents: ActionEvent[],
  workflowState: WorkflowState | null,
  currentDebugPlan: DebugPlan | null,
): TimelineProjection[] => {
  const turns = groupMessagesByTurn(messages);
  const coveredRunIds = new Set(turns.flatMap((turn) => turn.runIds));
  const eventsByUncoveredRun = new Map<string, ActionEvent[]>();

  for (const event of actionEvents) {
    if (workflowState?.runId && event.run_id !== workflowState.runId) {
      continue;
    }
    if (coveredRunIds.has(event.run_id)) {
      continue;
    }
    const events = eventsByUncoveredRun.get(event.run_id) ?? [];
    events.push(event);
    eventsByUncoveredRun.set(event.run_id, events);
  }

  for (const [runId, events] of eventsByUncoveredRun) {
    const sortedEvents = events.slice().sort((left, right) => left.ts_ms - right.ts_ms);
    turns.push({
      turnId: `run-${sanitizeId(runId)}`,
      messages: [],
      assistantMessages: [],
      runIds: [runId],
      createdAt: sortedEvents[0]?.ts_ms ?? Date.now(),
    });
  }

  if (turns.length === 0) {
    return [];
  }
  return turns
    .slice()
    .sort((left, right) => left.createdAt - right.createdAt)
    .map((turn) => buildTraceProjection(turn, actionEvents, workflowState, currentDebugPlan))
    .filter((projection) => projection.rootNodeIds.length > 0);
};

export const AgentChat: React.FC<{ mode: AgentMode }> = ({ mode }) => {
  const conversationMessages = useSessionStore((state) => state.conversationMessages);
  const actionEvents = useSessionStore((state) => state.actionEvents);
  const workflowState = useSessionStore((state) => state.workflowState);
  const currentDebugPlan = useSessionStore((state) => state.currentDebugPlan);
  const deferredMessages = useDeferredValue(conversationMessages);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef(true);

  const projections = useMemo(
    () => buildTimelineProjections(deferredMessages, actionEvents, workflowState, currentDebugPlan),
    [deferredMessages, actionEvents, workflowState, currentDebugPlan],
  );
  const currentStage = workflowState?.currentStage;
  const showPlanPhaseMarker = currentStage === 'plan' || workflowState?.approvalState === 'pending_user';
  const showExecutionPhaseMarker = Boolean(currentStage && !['preflight', 'plan'].includes(currentStage));

  useEffect(() => {
    if (navigator.webdriver) {
      return;
    }
    const container = scrollContainerRef.current;
    if (!container || !shouldStickToBottomRef.current) {
      return;
    }
    container.scrollTo({
      top: container.scrollHeight,
      behavior: 'smooth',
    });
  }, [projections]);

  const handleScroll = () => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    shouldStickToBottomRef.current = distanceFromBottom < STICKY_SCROLL_THRESHOLD;
  };

  const isEmpty = projections.length === 0;

  return (
    <div className={`agent-chat ${isEmpty ? 'is-empty' : ''}`} data-testid="agent-chat">
      <div className="chat-top-hard-stop" aria-hidden="true" />
      <div className="chat-top-transition-fade" aria-hidden="true" />
      <div
        ref={scrollContainerRef}
        className={`chat-messages scrollbar-thin ${isEmpty ? 'chat-messages-empty' : ''}`}
        data-testid="chat-messages"
        onScroll={handleScroll}
      >
        {showPlanPhaseMarker ? (
          <span className="phase-trace-compat-marker" data-testid="phase-trace-plan">Plan Phase</span>
        ) : null}
        {showExecutionPhaseMarker ? (
          <span className="phase-trace-compat-marker" data-testid="phase-trace-execution">Execution Phase</span>
        ) : null}
        <AgentMessageTimeline
          projections={projections}
          emptyState={<EmptyWorkbenchPrompt mode={mode} />}
        />
        <PlanApprovalCard />
      </div>
    </div>
  );
};

export default AgentChat;

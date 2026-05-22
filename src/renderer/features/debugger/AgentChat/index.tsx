import React, { useDeferredValue, useEffect, useMemo, useRef } from 'react';
import type {
  AgentEdge,
  AgentNode,
  AgentNodeStatus,
  AgentRunPayload,
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

interface ArtifactSource {
  id: string;
  name: string;
  path?: string;
  mimeType?: string;
  sizeBytes?: number;
  artifactType: ArtifactPayload['artifactType'];
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
  return actionEvents
    .filter((event) => event.turn_id === turn.turnId || runIds.has(event.run_id))
    .sort((left, right) => left.ts_ms - right.ts_ms);
};

const collectToolSources = (turn: TurnInput, events: ActionEvent[]): ToolSource[] => {
  const tools: ToolSource[] = [];

  for (const message of turn.assistantMessages) {
    for (const step of message.reasoningTrace?.steps ?? []) {
      for (const toolCall of step.toolCalls) {
        tools.push({
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
    const error = event.status === 'error' || event.status === 'fail'
      ? formatJsonPreview(event.payload.error || event.payload.message || '工具调用失败。')
      : undefined;
    tools.push({
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

const hasReasoningTrace = (message: ConversationMessage): boolean =>
  Boolean(message.reasoningTrace?.steps.some((step) => (
    step.summary
    || step.detail
    || step.toolCalls.length > 0
    || step.status === 'running'
    || step.status === 'error'
  )));

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
  parentId: string,
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
    defaultExpanded: true,
    payload: {
      groupType,
      strategy: 'collect',
      objective: summary,
    },
  });
  builder.addChild(parentId, node.id);
  return node;
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

  if (turn.userMessage) {
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
  const plan = actualRunId
    ? (workflowState?.runId === actualRunId ? (workflowState.debugPlan ?? currentDebugPlan) : currentDebugPlan)
    : undefined;
  const traceMessages = turn.assistantMessages.filter(hasReasoningTrace);
  const hasTraceDetails = Boolean(
    traceMessages.length > 0
    || events.length > 0
    || toolSources.length > 0
    || artifactSources.length > 0
    || reasoningSummaries.length > 0
    || harnessTasks.length > 0
    || plan?.blockers?.length
    || plan?.missingInfo?.length
  );

  if (hasTraceDetails) {
    const runStatus = aggregateStatus([
      assistantStatus,
      ...events.map(statusFromEvent),
      ...reasoningSteps.map((step) => step.status),
      ...harnessTasks.map((task) => statusFromHarness(task.status)),
    ]);
    const traceNode = builder.addNode<AgentRunPayload>({
      id: `${turn.turnId}-trace`,
      type: 'agent_run',
      status: runStatus,
      title: runStatus === 'running' || runStatus === 'streaming' ? '正在思考' : '已完成思考',
      summary: traceMessages[traceMessages.length - 1]?.reasoningTrace?.summary
        ?? plan?.scope
        ?? firstLine(turn.assistantMessages[0]?.content, 'Agent 轨迹'),
      runId,
      turnId: turn.turnId,
      order: 2,
      createdAt: traceMessages[0]?.reasoningTrace?.updatedAt ?? events[0]?.ts_ms ?? turn.assistantMessages[0]?.createdAt ?? baseTime,
      expandable: true,
      defaultExpanded: false,
      metrics: {
        durationMs: events.length > 0
          ? Math.max(...events.map((event) => event.ts_ms + event.duration_ms)) - baseTime
          : undefined,
      },
      payload: {
        agentName: 'Agent',
        objective: plan?.userGoal ?? turn.userMessage?.content ?? '处理当前请求。',
        inputSummary: turn.userMessage?.content,
        planSummary: plan?.scope,
        executionMode: 'debugging',
        progress: {
          completed: reasoningSteps.filter((step) => step.status === 'succeeded').length
            + toolSources.filter((tool) => tool.status === 'succeeded').length
            + harnessTasks.filter((task) => task.status === 'completed').length,
          total: Math.max(reasoningSteps.length + toolSources.length + harnessTasks.length, 1),
        },
      },
    });

    if (reasoningSteps.length > 0 || reasoningSummaries.length > 0 || events.some((event) => event.event_type !== 'tool_execution')) {
      const thinkingGroup = createGroupNode(
        builder,
        `${turn.turnId}-thinking-group`,
        '思考',
        '来自真实 reasoning trace 和运行事件。',
        1,
        reasoningSteps[0]?.startedAt ?? events[0]?.ts_ms ?? traceNode.createdAt,
        'section_group',
        aggregateStatus([
          ...reasoningSteps.map((step) => step.status),
          ...events.filter((event) => event.event_type !== 'tool_execution').map(statusFromEvent),
          ...reasoningSummaries.map(() => 'succeeded' as const),
        ]),
        traceNode.id,
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
          createdAt: Date.parse(summary.createdAt) || traceNode.createdAt,
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
      const toolGroup = createGroupNode(
        builder,
        `${turn.turnId}-tool-group`,
        '工具',
        `已记录 ${toolSources.length} 个工具调用。`,
        2,
        toolSources[0].startedAt,
        'tool_group',
        aggregateStatus(toolSources.map((tool) => tool.status)),
        traceNode.id,
      );
      toolSources.forEach((tool, index) => createToolNode(builder, tool, `${turn.turnId}-tool`, index + 1, toolGroup.id));
    }

    if (harnessTasks.length > 0 || plan?.missingInfo?.length || plan?.blockers?.length) {
      const questionGroup = createGroupNode(
        builder,
        `${turn.turnId}-question-group`,
        '需要用户确认',
        '来自计划、任务看板或阻塞状态。',
        3,
        traceNode.createdAt + 3,
        'section_group',
        aggregateStatus([
          ...harnessTasks.map((task) => statusFromHarness(task.status)),
          ...(plan?.blockers?.length ? ['blocked' as const] : []),
        ]),
        traceNode.id,
      );

      harnessTasks.forEach((task, index) => {
        const nodeId = `${turn.turnId}-task-${sanitizeId(task.taskId)}`;
        builder.addNode<StepPayload>({
          id: nodeId,
          type: 'step',
          status: statusFromHarness(task.status),
          title: task.title,
          summary: task.objective,
          runId,
          turnId: turn.turnId,
          order: index + 1,
          createdAt: Date.parse(task.createdAt) || traceNode.createdAt,
          completedAt: task.completedAt ? Date.parse(task.completedAt) : undefined,
          payload: {
            objective: task.intent,
            actualOutput: task.acceptanceCriteria.join('\n'),
          },
        });
        builder.addChild(questionGroup.id, nodeId);
      });

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
            order: harnessTasks.length + index + 1,
            createdAt: traceNode.createdAt + index + 1,
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
        4,
        traceNode.createdAt + 4,
        'evidence_group',
        'succeeded',
        traceNode.id,
      );

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
          createdAt: traceNode.createdAt + 5 + index,
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
        5,
        traceNode.createdAt + 5,
        'artifact_group',
        'succeeded',
        traceNode.id,
      );

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
          createdAt: traceNode.createdAt + index + 1,
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
    .filter((message) => message.content.trim().length > 0)
    .forEach((message, index) => {
      builder.addNode({
        id: `${message.id}-assistant`,
        type: 'assistant_message',
        status: statusFromMessage(message),
        title: 'Assistant Message',
        summary: message.content,
        runId: message.runId ?? runId,
        turnId: turn.turnId,
        order: 3 + index,
        createdAt: message.createdAt,
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
  if (turns.length === 0) {
    return [];
  }
  return turns.map((turn) => buildTraceProjection(turn, actionEvents, workflowState, currentDebugPlan));
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
      </div>
    </div>
  );
};

export default AgentChat;

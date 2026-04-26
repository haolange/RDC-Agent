import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { AGENT_DISPLAY_NAMES, getAgentModeConfig } from '@shared/constants/agents';
import type { AgentRole } from '@shared/types/agent';
import type { ConversationMessage, ConversationToolCall } from '@shared/types/conversation';
import type { ActionEvent } from '@shared/types/evidence';
import type { AgentMode } from '@shared/types/layout';
import type { SessionAttachmentRecord } from '@shared/types/session';
import type { WorkflowStage, WorkflowState } from '@shared/types/workflow';
import { useI18n } from '../../i18n';
import { useSessionStore } from '../../stores/sessionStore';
import { EmptyWorkbenchPrompt } from '../EmptyWorkbenchPrompt';
import { ModeGlyph } from '../ModeGlyph';
import './AgentChat.css';

const STICKY_SCROLL_THRESHOLD = 96;

type TraceStatus = 'pending' | 'running' | 'complete' | 'error';
type TracePhase = 'conversation' | 'plan' | 'execution' | 'activity';
type TraceSource = 'reasoning' | 'action-events' | 'workflow';

interface TraceArtifactView {
  id: string;
  label: string;
  path: string;
  kind: 'image' | 'file';
}

interface TraceStepView {
  id: string;
  title: string;
  status: TraceStatus;
  summary?: string;
  detail?: string;
  stage?: string;
  agentId?: AgentRole | string;
  duration?: string | null;
  toolCalls: ConversationToolCall[];
  artifacts: TraceArtifactView[];
  isAgentRun?: boolean;
}

interface PhaseTraceView {
  id: string;
  title: string;
  phase: TracePhase;
  status: TraceStatus;
  source: TraceSource;
  steps: TraceStepView[];
}

interface ConversationTurnView {
  turnId: string;
  messages: ConversationMessage[];
  userMessage?: ConversationMessage;
  assistantMessages: ConversationMessage[];
  systemMessages: ConversationMessage[];
  phaseCards: PhaseTraceView[];
  createdAt: number;
  runIds: string[];
}

const PLAN_STAGES = new Set<WorkflowStage>(['preflight', 'entry_gate', 'intake_gate', 'plan', 'speclist']);
const EXECUTION_STAGES = new Set<WorkflowStage>(['dispatch', 'investigate', 'fix_verify', 'skepti', 'curate', 'finalize']);

const formatTime = (timestamp: number, language: string): string =>
  new Date(timestamp).toLocaleTimeString(language === 'zh-CN' ? 'zh-CN' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });

const formatAttachmentSize = (size: number): string => {
  if (!size) {
    return '';
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${Math.round(size / 1024)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

const formatDuration = (startedAt: number, completedAt?: number): string | null => {
  if (!completedAt || completedAt <= startedAt) {
    return null;
  }
  const durationMs = completedAt - startedAt;
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }
  return `${(durationMs / 1000).toFixed(1)}s`;
};

const formatDurationMs = (durationMs: number): string | null => {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return null;
  }
  if (durationMs < 1000) {
    return `${Math.round(durationMs)}ms`;
  }
  return `${(durationMs / 1000).toFixed(1)}s`;
};

const resolveEntryMode = (entry: ConversationMessage, fallbackMode: AgentMode): AgentMode =>
  entry.modeContext ?? fallbackMode;

const normalizeStatus = (status: string | undefined): TraceStatus => {
  if (status === 'pending' || status === 'queued' || status === 'awaiting_approval' || status === 'awaiting_input') {
    return 'pending';
  }
  if (status === 'running' || status === 'draft' || status === 'streaming' || status === 'entered' || status === 'sent') {
    return 'running';
  }
  if (status === 'error' || status === 'fail' || status === 'failed' || status === 'blocked' || status === 'timeout') {
    return 'error';
  }
  return 'complete';
};

const getStagePhase = (stage?: string | null): TracePhase => {
  if (!stage) {
    return 'activity';
  }
  if (PLAN_STAGES.has(stage as WorkflowStage)) {
    return 'plan';
  }
  if (EXECUTION_STAGES.has(stage as WorkflowStage)) {
    return 'execution';
  }
  return 'activity';
};

const getPhaseTitle = (phase: TracePhase): string => {
  if (phase === 'plan') {
    return '规划阶段轨迹 (Plan Phase)';
  }
  if (phase === 'execution') {
    return '执行阶段轨迹 (Execution Phase)';
  }
  if (phase === 'conversation') {
    return '协作消息轨迹 (Conversation Phase)';
  }
  return '活动记录 (Activity)';
};

const getPhaseStatus = (steps: TraceStepView[]): TraceStatus => {
  if (steps.some((step) => step.status === 'error')) {
    return 'error';
  }
  if (steps.some((step) => step.status === 'running')) {
    return 'running';
  }
  if (steps.some((step) => step.status === 'pending')) {
    return 'pending';
  }
  return 'complete';
};

const getPayloadString = (payload: Record<string, unknown>, keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
    if (typeof value === 'number') {
      return String(value);
    }
  }
  return undefined;
};

const isImagePath = (value: string): boolean => /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(value);

const looksLikePath = (value: string): boolean =>
  /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('/') || value.includes('\\') || value.includes('/');

const extractArtifactsFromValue = (value: unknown, idPrefix: string, artifacts: TraceArtifactView[]) => {
  if (typeof value === 'string') {
    if (!looksLikePath(value)) {
      return;
    }
    const normalized = value.replace(/\\/g, '/');
    const label = normalized.split('/').filter(Boolean).pop() ?? value;
    artifacts.push({
      id: `${idPrefix}-${artifacts.length}`,
      label,
      path: value,
      kind: isImagePath(value) ? 'image' : 'file',
    });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => extractArtifactsFromValue(entry, `${idPrefix}-${index}`, artifacts));
    return;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const pathValue = record.path ?? record.filePath ?? record.output_path ?? record.htmlPath ?? record.markdownPath;
    if (pathValue) {
      extractArtifactsFromValue(pathValue, idPrefix, artifacts);
    }
    for (const [key, entry] of Object.entries(record)) {
      if (/path|file|artifact|image|screenshot/i.test(key)) {
        extractArtifactsFromValue(entry, `${idPrefix}-${key}`, artifacts);
      }
    }
  }
};

const extractArtifactsFromPayload = (payload: Record<string, unknown>, idPrefix: string): TraceArtifactView[] => {
  const artifacts: TraceArtifactView[] = [];
  extractArtifactsFromValue(payload, idPrefix, artifacts);
  const seen = new Set<string>();
  return artifacts.filter((artifact) => {
    const key = `${artifact.kind}:${artifact.path}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

const renderInlineSegments = (text: string, keyPrefix: string): React.ReactNode[] => {
  const nodes: React.ReactNode[] = [];
  const inlinePattern = /`([^`]+)`/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = inlinePattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    nodes.push(
      <code key={`${keyPrefix}-code-${nodes.length}`} className="formatted-message-inline-code">
        {match[1]}
      </code>,
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
};

const renderTextSegment = (segment: string, keyPrefix: string): React.ReactNode[] => {
  const nodes: React.ReactNode[] = [];
  const lines = segment.split(/\r?\n/);
  let paragraph: string[] = [];
  let listItems: Array<{ value: string; ordered: boolean }> = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) {
      return;
    }
    const value = paragraph.join(' ');
    nodes.push(
      <p key={`${keyPrefix}-p-${nodes.length}`} className="formatted-message-paragraph">
        {renderInlineSegments(value, `${keyPrefix}-p-${nodes.length}`)}
      </p>,
    );
    paragraph = [];
  };

  const flushList = () => {
    if (listItems.length === 0) {
      return;
    }
    const ordered = listItems[0].ordered;
    const Tag = ordered ? 'ol' : 'ul';
    nodes.push(
      <Tag key={`${keyPrefix}-list-${nodes.length}`} className="formatted-message-list">
        {listItems.map((item, index) => (
          <li key={`${keyPrefix}-li-${index}`}>
            {renderInlineSegments(item.value, `${keyPrefix}-li-${index}`)}
          </li>
        ))}
      </Tag>,
    );
    listItems = [];
  };

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      flushList();
      return;
    }

    const bulletMatch = trimmed.match(/^[-*]\s+(.+)$/);
    const orderedMatch = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (bulletMatch || orderedMatch) {
      flushParagraph();
      const ordered = Boolean(orderedMatch);
      if (listItems.length > 0 && listItems[0].ordered !== ordered) {
        flushList();
      }
      listItems.push({ value: (bulletMatch?.[1] ?? orderedMatch?.[1] ?? '').trim(), ordered });
      return;
    }

    flushList();
    paragraph.push(trimmed);
  });

  flushParagraph();
  flushList();
  return nodes;
};

const FormattedMessageContent: React.FC<{ content: string }> = ({ content }) => {
  const nodes: React.ReactNode[] = [];
  const fencePattern = /```([a-zA-Z0-9_-]+)?\r?\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = fencePattern.exec(content)) !== null) {
    nodes.push(...renderTextSegment(content.slice(lastIndex, match.index), `text-${nodes.length}`));
    const language = match[1] ?? '';
    nodes.push(
      <pre key={`code-${nodes.length}`} className="formatted-message-code">
        {language ? <span className="formatted-message-code-lang">{language}</span> : null}
        <code>{match[2]}</code>
      </pre>,
    );
    lastIndex = match.index + match[0].length;
  }

  nodes.push(...renderTextSegment(content.slice(lastIndex), `text-${nodes.length}`));

  return <div className="formatted-message-content">{nodes.length > 0 ? nodes : content}</div>;
};

const MessageModeBadge: React.FC<{ mode: AgentMode }> = ({ mode }) => {
  const { t } = useI18n();
  const modeConfig = getAgentModeConfig(mode);

  return (
    <span className="message-mode-badge" style={{ ['--message-mode-accent' as string]: modeConfig.accentColor }}>
      <ModeGlyph mode={mode} className="message-mode-badge-icon" size={12} strokeWidth={1.9} />
      <span>{t(`mode.${mode}`)}</span>
    </span>
  );
};

const MessageAttachments: React.FC<{ attachments: SessionAttachmentRecord[] }> = ({ attachments }) => {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className="message-attachments">
      {attachments.map((attachment) => (
        <button
          key={attachment.attachmentId}
          type="button"
          className={`message-attachment-pill ${attachment.kind}`}
          onClick={() => void window.electronAPI?.appShell.openPath(attachment.filePath)}
        >
          <span className="message-attachment-pill-icon" aria-hidden="true">
            {attachment.kind === 'image' ? 'IMG' : 'FILE'}
          </span>
          <span className="message-attachment-pill-copy">
            <span className="message-attachment-pill-name">{attachment.fileName}</span>
            <span className="message-attachment-pill-meta">{formatAttachmentSize(attachment.size)}</span>
          </span>
        </button>
      ))}
    </div>
  );
};

const buildReasoningPhaseCards = (message: ConversationMessage): PhaseTraceView[] => {
  const trace = message.reasoningTrace;
  if (!trace || trace.steps.length === 0) {
    return [];
  }

  const steps = trace.steps.map((step): TraceStepView => ({
    id: `${message.id}-${step.id}`,
    title: step.title,
    status: normalizeStatus(step.status),
    summary: step.summary,
    detail: step.detail,
    stage: step.stage,
    agentId: message.agentId,
    duration: formatDuration(step.startedAt, step.completedAt),
    toolCalls: step.toolCalls,
    artifacts: [],
  }));

  return [{
    id: `${message.id}-reasoning`,
    title: getPhaseTitle('conversation'),
    phase: 'conversation',
    status: normalizeStatus(trace.status),
    source: 'reasoning',
    steps,
  }];
};

const buildActionEventPhaseCards = (turn: ConversationTurnView, actionEvents: ActionEvent[]): PhaseTraceView[] => {
  const runIdSet = new Set(turn.runIds);
  const events = actionEvents
    .filter((event) => event.turn_id === turn.turnId || (event.run_id && runIdSet.has(event.run_id)))
    .sort((left, right) => left.ts_ms - right.ts_ms);

  if (events.length === 0) {
    return [];
  }

  const grouped = new Map<TracePhase, TraceStepView[]>();

  for (const event of events) {
    const stage = getPayloadString(event.payload, ['toStage', 'stage', 'workflow_stage']);
    const phase = getStagePhase(stage);
    const summary = getPayloadString(event.payload, [
      'summary',
      'reason',
      'objective',
      'content',
      'verdict',
      'message',
      'toStage',
      'tool_name',
    ]) ?? event.event_type;
    const detail = event.event_type === 'tool_execution'
      ? undefined
      : JSON.stringify(event.payload, null, 2);
    const toolCalls: ConversationToolCall[] = event.event_type === 'tool_execution'
      ? [{
          id: event.event_id,
          toolName: getPayloadString(event.payload, ['tool_name']) ?? 'tool',
          status: normalizeStatus(event.status) === 'error' ? 'error' : 'complete',
          argsPreview: event.payload.args ? JSON.stringify(event.payload.args, null, 2) : undefined,
          resultPreview: event.payload.data || event.payload.result
            ? JSON.stringify(event.payload.data ?? event.payload.result, null, 2)
            : undefined,
          error: event.status === 'error' ? getPayloadString(event.payload, ['error', 'message']) : undefined,
          startedAt: event.ts_ms,
          completedAt: event.ts_ms + event.duration_ms,
        }]
      : [];

    const step: TraceStepView = {
      id: event.event_id,
      title: stage ? `阶段：${stage}` : event.event_type,
      status: normalizeStatus(event.status),
      summary,
      detail,
      stage,
      agentId: event.agent_id,
      duration: formatDurationMs(event.duration_ms),
      toolCalls,
      artifacts: extractArtifactsFromPayload(event.payload, event.event_id),
      isAgentRun: event.agent_id !== 'rdc-debugger' || event.event_type.includes('specialist'),
    };

    grouped.set(phase, [...(grouped.get(phase) ?? []), step]);
  }

  return Array.from(grouped.entries()).map(([phase, steps]) => ({
    id: `${turn.turnId}-${phase}-events`,
    title: getPhaseTitle(phase),
    phase,
    status: getPhaseStatus(steps),
    source: 'action-events',
    steps,
  }));
};

const buildWorkflowPhaseCard = (turn: ConversationTurnView, workflowState: WorkflowState | null): PhaseTraceView[] => {
  if (!workflowState || !turn.runIds.includes(workflowState.runId)) {
    return [];
  }

  const stages = [...workflowState.previousStages, workflowState.currentStage];
  const steps = stages.map((stage, index): TraceStepView => ({
    id: `${workflowState.runId}-${stage}-${index}`,
    title: `阶段：${stage}`,
    status: stage === workflowState.currentStage ? normalizeStatus(workflowState.approvalState ?? 'running') : 'complete',
    summary: stage === workflowState.currentStage ? '当前工作流阶段。' : '阶段已进入或完成。',
    stage,
    agentId: 'rdc-debugger',
    duration: null,
    toolCalls: [],
    artifacts: [],
  }));

  const phase = getStagePhase(workflowState.currentStage);
  return [{
    id: `${workflowState.runId}-workflow-state`,
    title: getPhaseTitle(phase),
    phase,
    status: normalizeStatus(workflowState.approvalState ?? 'running'),
    source: 'workflow',
    steps,
  }];
};

const mergePhaseCards = (cards: PhaseTraceView[]): PhaseTraceView[] => {
  const byKey = new Map<string, PhaseTraceView>();
  for (const card of cards) {
    const key = `${card.phase}:${card.title}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...card, steps: [...card.steps] });
      continue;
    }
    existing.steps.push(...card.steps);
    existing.status = getPhaseStatus(existing.steps);
    existing.source = existing.source === card.source ? existing.source : 'action-events';
  }
  const order: TracePhase[] = ['conversation', 'plan', 'execution', 'activity'];
  return Array.from(byKey.values()).sort((left, right) => order.indexOf(left.phase) - order.indexOf(right.phase));
};

const buildConversationTurns = (
  messages: ConversationMessage[],
  actionEvents: ActionEvent[],
  workflowState: WorkflowState | null,
): ConversationTurnView[] => {
  const byTurn = new Map<string, ConversationTurnView>();

  for (const message of messages) {
    const key = message.turnId || message.id;
    const current = byTurn.get(key) ?? {
      turnId: key,
      messages: [],
      assistantMessages: [],
      systemMessages: [],
      phaseCards: [],
      createdAt: message.createdAt,
      runIds: [],
    };

    current.messages.push(message);
    current.createdAt = Math.min(current.createdAt, message.createdAt);
    if (message.role === 'user' && !current.userMessage) {
      current.userMessage = message;
    } else if (message.role === 'assistant') {
      current.assistantMessages.push(message);
      if (message.runId && !current.runIds.includes(message.runId)) {
        current.runIds.push(message.runId);
      }
    } else {
      current.systemMessages.push(message);
    }

    if (message.runId && !current.runIds.includes(message.runId)) {
      current.runIds.push(message.runId);
    }

    byTurn.set(key, current);
  }

  const turns = Array.from(byTurn.values()).sort((left, right) => left.createdAt - right.createdAt);
  return turns.map((turn) => {
    const reasoningCards = turn.assistantMessages.flatMap(buildReasoningPhaseCards);
    const eventCards = buildActionEventPhaseCards(turn, actionEvents);
    const workflowCards = buildWorkflowPhaseCard(turn, workflowState);
    return {
      ...turn,
      messages: turn.messages.slice().sort((left, right) => left.createdAt - right.createdAt),
      assistantMessages: turn.assistantMessages.slice().sort((left, right) => left.createdAt - right.createdAt),
      systemMessages: turn.systemMessages.slice().sort((left, right) => left.createdAt - right.createdAt),
      phaseCards: mergePhaseCards([...reasoningCards, ...eventCards, ...workflowCards]),
    };
  });
};

const StatusBadge: React.FC<{ status: TraceStatus }> = ({ status }) => {
  const { t } = useI18n();
  return (
    <span className={`flow-status status-${status}`}>
      {status === 'pending' && t('chat.statusPending')}
      {status === 'running' && t('chat.statusRunning')}
      {status === 'complete' && t('chat.statusComplete')}
      {status === 'error' && t('chat.statusError')}
    </span>
  );
};

const TaskBriefCard: React.FC<{ entry: ConversationMessage; fallbackMode: AgentMode }> = ({ entry, fallbackMode }) => {
  const { language, t } = useI18n();
  const mode = resolveEntryMode(entry, fallbackMode);
  return (
    <article className="transcript-message transcript-user chat-message user" data-testid="conversation-user-brief">
      <header className="message-header">
        <div className="message-header-main">
          <span className="message-avatar user">U</span>
          <span className="message-author">{t('chat.you')}</span>
          <MessageModeBadge mode={mode} />
        </div>
        <span className="message-time">{formatTime(entry.createdAt, language)}</span>
      </header>
      {entry.content ? (
        <div className="message-bubble user task-brief-content">
          <FormattedMessageContent content={entry.content} />
        </div>
      ) : null}
      <MessageAttachments attachments={entry.attachments ?? []} />
    </article>
  );
};

const AssistantDocumentCard: React.FC<{ entry: ConversationMessage; fallbackMode: AgentMode }> = ({ entry, fallbackMode }) => {
  const { language, t } = useI18n();
  const role = entry.agentId as AgentRole | undefined;
  const mode = resolveEntryMode(entry, fallbackMode);
  const modeConfig = getAgentModeConfig(mode);
  const modeLabel = t(`mode.${mode}`);
  const name = role === 'rdc-debugger'
    ? modeLabel
    : role
      ? (AGENT_DISPLAY_NAMES[role] ?? role)
      : modeLabel;

  if (!entry.content && entry.status !== 'streaming' && entry.status !== 'draft') {
    return null;
  }

  return (
    <article className="transcript-message transcript-assistant chat-message assistant" data-testid="conversation-assistant-card">
      <header className="message-header">
        <div className="message-header-main">
          <span
            className={`message-avatar assistant mode-${mode}`}
            style={{ ['--message-mode-accent' as string]: modeConfig.accentColor }}
          >
            <ModeGlyph mode={mode} size={16} strokeWidth={1.9} />
          </span>
          <span className="message-author">{name}</span>
          <MessageModeBadge mode={mode} />
        </div>
        <span className="message-time">{formatTime(entry.createdAt, language)}</span>
      </header>
      <div className={`assistant-document ${entry.content ? '' : 'is-empty'}`} data-testid="assistant-document-flow">
        {entry.content ? <FormattedMessageContent content={entry.content} /> : null}
      </div>
      <MessageAttachments attachments={entry.attachments ?? []} />
    </article>
  );
};

const ArtifactGrid: React.FC<{ artifacts: TraceArtifactView[] }> = ({ artifacts }) => {
  if (artifacts.length === 0) {
    return null;
  }
  return (
    <div className="artifact-grid">
      {artifacts.map((artifact) => (
        <button
          key={artifact.id}
          type="button"
          className={`artifact-card ${artifact.kind}`}
          onClick={() => void window.electronAPI?.appShell.openPath(artifact.path)}
        >
          {artifact.kind === 'image' ? (
            <span className="artifact-image-placeholder" aria-hidden="true">Image</span>
          ) : (
            <span className="artifact-file-icon" aria-hidden="true">FILE</span>
          )}
          <span className="artifact-label">{artifact.label}</span>
        </button>
      ))}
    </div>
  );
};

const ToolCallCard: React.FC<{ toolCall: ConversationToolCall }> = ({ toolCall }) => (
  <div className={`reasoning-tool-call status-${toolCall.status}`} data-testid="assistant-tool-call-inline">
    <div className="reasoning-tool-header">
      <span className="reasoning-tool-name">{toolCall.toolName}</span>
      <span className={`reasoning-tool-status status-${toolCall.status}`}>{toolCall.status}</span>
    </div>
    {toolCall.argsPreview ? <pre className="reasoning-tool-block">{toolCall.argsPreview}</pre> : null}
    {toolCall.resultPreview ? <pre className="reasoning-tool-block">{toolCall.resultPreview}</pre> : null}
    {toolCall.error ? <div className="reasoning-tool-error">{toolCall.error}</div> : null}
  </div>
);

const AgentRunCard: React.FC<{ step: TraceStepView; index: number; expanded: boolean; onToggle: () => void }> = ({
  step,
  index,
  expanded,
  onToggle,
}) => {
  const agentName = step.agentId && AGENT_DISPLAY_NAMES[step.agentId as AgentRole]
    ? AGENT_DISPLAY_NAMES[step.agentId as AgentRole]
    : step.agentId ?? 'Agent';
  const detailCount = step.toolCalls.length + step.artifacts.length + (step.detail ? 1 : 0);

  return (
    <div className={`agent-run-card status-${step.status}`} data-testid="agent-run-card">
      <div className="agent-run-head">
        <div className="agent-run-title">
          <span className="agent-run-icon" aria-hidden="true">AG</span>
          <span>{agentName}</span>
        </div>
        <span className="agent-run-index">{String(index + 1).padStart(2, '0')}</span>
      </div>
      <button type="button" className="trace-step-expand agent-run-objective" onClick={onToggle}>
        <span>{step.title}</span>
        {detailCount > 0 ? <span>{expanded ? '收起' : `查看 ${detailCount} 个步骤`}</span> : null}
      </button>
      {step.summary ? <div className="agent-run-summary">{step.summary}</div> : null}
      {expanded ? (
        <div className="trace-step-detail-block">
          {step.detail ? <pre className="reasoning-tool-block">{step.detail}</pre> : null}
          {step.toolCalls.map((toolCall) => <ToolCallCard key={toolCall.id} toolCall={toolCall} />)}
          <ArtifactGrid artifacts={step.artifacts} />
        </div>
      ) : null}
    </div>
  );
};

const TraceStep: React.FC<{
  step: TraceStepView;
  index: number;
  expanded: boolean;
  onToggle: () => void;
}> = ({ step, index, expanded, onToggle }) => {
  const detailCount = step.toolCalls.length + step.artifacts.length + (step.detail ? 1 : 0);

  if (step.isAgentRun) {
    return <AgentRunCard step={step} index={index} expanded={expanded} onToggle={onToggle} />;
  }

  return (
    <div className={`trace-step status-${step.status}`} data-testid="trace-step">
      <div className="trace-step-marker" aria-hidden="true" />
      <div className="trace-step-body">
        <div className="trace-step-header">
          <div className="trace-step-title-row">
            <span className="trace-step-title">{step.title}</span>
            <StatusBadge status={step.status} />
          </div>
          <div className="trace-step-meta">
            {step.stage ? <span>{step.stage}</span> : null}
            {step.duration ? <span>{step.duration}</span> : null}
          </div>
        </div>
        {step.summary ? <div className="trace-step-summary">{step.summary}</div> : null}
        {detailCount > 0 ? (
          <button type="button" className="trace-step-expand" onClick={onToggle}>
            <span>{expanded ? '收起步骤' : `查看 ${detailCount} 个步骤`}</span>
          </button>
        ) : null}
        {expanded ? (
          <div className="trace-step-detail-block">
            {step.detail ? <pre className="reasoning-tool-block">{step.detail}</pre> : null}
            {step.toolCalls.map((toolCall) => <ToolCallCard key={toolCall.id} toolCall={toolCall} />)}
            <ArtifactGrid artifacts={step.artifacts} />
          </div>
        ) : null}
      </div>
    </div>
  );
};

const PhaseTraceCard: React.FC<{
  card: PhaseTraceView;
  expanded: boolean;
  expandedSteps: Record<string, boolean>;
  onToggleCard: () => void;
  onToggleStep: (stepId: string) => void;
}> = ({ card, expanded, expandedSteps, onToggleCard, onToggleStep }) => (
  <section className={`flow-card phase-trace-card phase-${card.phase} status-${card.status}`} data-testid={`phase-trace-${card.phase}`}>
    <button
      type="button"
      className="phase-trace-header"
      data-testid="assistant-reasoning-toggle"
      aria-expanded={expanded}
      onClick={onToggleCard}
    >
      <span className="phase-trace-title-wrap">
        <span className="phase-trace-caret">{expanded ? '-' : '+'}</span>
        <span className="phase-trace-title">{card.title}</span>
        <span className="phase-trace-source">{card.source}</span>
      </span>
      <span className="phase-trace-meta">
        <StatusBadge status={card.status} />
        <span>{card.steps.length} 个步骤</span>
      </span>
    </button>
    {expanded ? (
      <div className="reasoning-panel phase-trace-steps" data-testid="assistant-reasoning-panel">
        {card.steps.map((step, index) => (
          <TraceStep
            key={step.id}
            step={step}
            index={index}
            expanded={expandedSteps[step.id] ?? false}
            onToggle={() => onToggleStep(step.id)}
          />
        ))}
      </div>
    ) : null}
  </section>
);

const SystemMessageCard: React.FC<{ entry: ConversationMessage }> = ({ entry }) => {
  const { language, t } = useI18n();
  return (
    <article className="flow-card system-message-card chat-message system">
      <header className="flow-card-header">
        <div className="flow-card-title-row">
          <span className="message-avatar system">!</span>
          <span className="flow-card-title">{t('chat.system')}</span>
        </div>
        <span className="message-time">{formatTime(entry.createdAt, language)}</span>
      </header>
      {entry.content ? <div className="message-bubble system"><FormattedMessageContent content={entry.content} /></div> : null}
      <MessageAttachments attachments={entry.attachments ?? []} />
    </article>
  );
};

const ConversationTurn: React.FC<{
  turn: ConversationTurnView;
  fallbackMode: AgentMode;
  expandedCards: Record<string, boolean>;
  expandedSteps: Record<string, boolean>;
  onToggleCard: (id: string) => void;
  onToggleStep: (id: string) => void;
}> = ({ turn, fallbackMode, expandedCards, expandedSteps, onToggleCard, onToggleStep }) => {
  const conversationPhaseCards = turn.phaseCards.filter((card) => card.phase === 'conversation');
  const taskPhaseCards = turn.phaseCards.filter((card) => card.phase !== 'conversation');
  const renderPhaseCard = (card: PhaseTraceView) => (
    <PhaseTraceCard
      key={card.id}
      card={card}
      expanded={expandedCards[card.id] ?? true}
      expandedSteps={expandedSteps}
      onToggleCard={() => onToggleCard(card.id)}
      onToggleStep={onToggleStep}
    />
  );

  return (
    <div className="conversation-turn" data-testid="conversation-turn">
      {turn.userMessage ? <TaskBriefCard entry={turn.userMessage} fallbackMode={fallbackMode} /> : null}
      {conversationPhaseCards.map(renderPhaseCard)}
      {turn.assistantMessages.map((entry) => (
        <AssistantDocumentCard key={entry.id} entry={entry} fallbackMode={fallbackMode} />
      ))}
      {taskPhaseCards.map(renderPhaseCard)}
      {turn.systemMessages.map((entry) => <SystemMessageCard key={entry.id} entry={entry} />)}
    </div>
  );
};

export const AgentChat: React.FC<{ mode: AgentMode }> = ({ mode }) => {
  const conversationMessages = useSessionStore((state) => state.conversationMessages);
  const actionEvents = useSessionStore((state) => state.actionEvents);
  const workflowState = useSessionStore((state) => state.workflowState);
  const deferredMessages = useDeferredValue(conversationMessages);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef(true);
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});
  const [expandedSteps, setExpandedSteps] = useState<Record<string, boolean>>({});

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
  }, [deferredMessages, actionEvents, workflowState]);

  const handleScroll = () => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    shouldStickToBottomRef.current = distanceFromBottom < STICKY_SCROLL_THRESHOLD;
  };

  const toggleCard = (id: string) => {
    setExpandedCards((current) => ({ ...current, [id]: !(current[id] ?? true) }));
  };

  const toggleStep = (id: string) => {
    setExpandedSteps((current) => ({ ...current, [id]: !current[id] }));
  };

  const turns = useMemo(
    () => buildConversationTurns(deferredMessages, actionEvents, workflowState),
    [deferredMessages, actionEvents, workflowState],
  );
  const isEmpty = turns.length === 0;

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
        {isEmpty ? (
          <EmptyWorkbenchPrompt mode={mode} />
        ) : turns.map((turn) => (
          <ConversationTurn
            key={turn.turnId}
            turn={turn}
            fallbackMode={mode}
            expandedCards={expandedCards}
            expandedSteps={expandedSteps}
            onToggleCard={toggleCard}
            onToggleStep={toggleStep}
          />
        ))}
      </div>
    </div>
  );
};

export default AgentChat;

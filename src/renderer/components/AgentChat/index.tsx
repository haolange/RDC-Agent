import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { AGENT_DISPLAY_NAMES, getAgentModeConfig } from '@shared/constants/agents';
import type { AgentRole } from '@shared/types/agent';
import type { AgentMode } from '@shared/types/layout';
import type {
  ConversationMessage,
  ConversationReasoningStep,
  ConversationReasoningTrace,
} from '@shared/types/conversation';
import type { SessionAttachmentRecord } from '@shared/types/session';
import { useI18n } from '../../i18n';
import { useSessionStore } from '../../stores/sessionStore';
import { EmptyWorkbenchPrompt } from '../EmptyWorkbenchPrompt';
import { ModeGlyph } from '../ModeGlyph';
import './AgentChat.css';

const STICKY_SCROLL_THRESHOLD = 96;

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

const getTraceStepCount = (trace: ConversationReasoningTrace | null | undefined) => trace?.steps.length ?? 0;

const getTraceToolCount = (trace: ConversationReasoningTrace | null | undefined) => (
  trace?.steps.reduce((count, step) => count + step.toolCalls.length, 0) ?? 0
);

const getReasoningSummary = (
  entry: ConversationMessage,
  fallbackThinking: string,
  fallbackReasoning: string,
): string => {
  if (entry.reasoningTrace?.summary) {
    return entry.reasoningTrace.summary;
  }
  if (entry.status === 'streaming' || entry.status === 'draft') {
    return fallbackThinking;
  }
  return fallbackReasoning;
};

const MessageAttachments: React.FC<{
  attachments: SessionAttachmentRecord[];
  align?: 'left' | 'right';
}> = ({ attachments, align = 'left' }) => {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className={`message-attachments align-${align}`}>
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

const resolveEntryMode = (entry: ConversationMessage, fallbackMode: AgentMode): AgentMode =>
  entry.modeContext ?? fallbackMode;

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

const StepStatusBadge: React.FC<{ status: ConversationReasoningStep['status'] }> = ({ status }) => {
  const { t } = useI18n();

  return (
    <span className={`reasoning-step-status status-${status}`}>
      {status === 'pending' && t('chat.statusPending')}
      {status === 'running' && t('chat.statusRunning')}
      {status === 'complete' && t('chat.statusComplete')}
      {status === 'error' && t('chat.statusError')}
    </span>
  );
};

const ReasoningPanel: React.FC<{ trace: ConversationReasoningTrace }> = ({ trace }) => (
  <div className="reasoning-panel" data-testid="assistant-reasoning-panel">
    {trace.steps.map((step) => {
      const duration = formatDuration(step.startedAt, step.completedAt);
      return (
        <div key={step.id} className={`reasoning-step status-${step.status}`}>
          <div className="reasoning-step-header">
            <div className="reasoning-step-title-row">
              <span className="reasoning-step-title">{step.title}</span>
              <StepStatusBadge status={step.status} />
            </div>
            <div className="reasoning-step-meta">
              {step.stage ? <span className="reasoning-step-stage">{step.stage}</span> : null}
              {duration ? <span className="reasoning-step-duration">{duration}</span> : null}
            </div>
          </div>
          {step.summary ? <div className="reasoning-step-summary">{step.summary}</div> : null}
          {step.detail ? <div className="reasoning-step-detail">{step.detail}</div> : null}
          {step.toolCalls.length > 0 ? (
            <div className="reasoning-tool-list">
              {step.toolCalls.map((toolCall) => (
                <div key={toolCall.id} className={`reasoning-tool-call status-${toolCall.status}`}>
                  <div className="reasoning-tool-header">
                    <span className="reasoning-tool-name">{toolCall.toolName}</span>
                    <span className={`reasoning-tool-status status-${toolCall.status}`}>{toolCall.status}</span>
                  </div>
                  {toolCall.argsPreview ? <pre className="reasoning-tool-block">{toolCall.argsPreview}</pre> : null}
                  {toolCall.resultPreview ? <pre className="reasoning-tool-block">{toolCall.resultPreview}</pre> : null}
                  {toolCall.error ? <div className="reasoning-tool-error">{toolCall.error}</div> : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      );
    })}
  </div>
);

const ReasoningRail: React.FC<{
  entry: ConversationMessage;
  expanded: boolean;
  onToggle: () => void;
}> = ({ entry, expanded, onToggle }) => {
  const { t } = useI18n();
  const stepCount = getTraceStepCount(entry.reasoningTrace);
  const toolCount = getTraceToolCount(entry.reasoningTrace);
  const railLabel = entry.status === 'streaming' || entry.status === 'draft'
    ? t('chat.thinking')
    : t('chat.reasoningTrace');

  return (
    <button
      type="button"
      className={`reasoning-rail ${expanded ? 'expanded' : ''} ${entry.status === 'streaming' ? 'is-streaming' : ''}`}
      data-testid="assistant-reasoning-toggle"
      onClick={onToggle}
      aria-expanded={expanded}
    >
      <span className="reasoning-rail-leading">
        <span className="reasoning-rail-label">{railLabel}</span>
        <span className="reasoning-rail-summary">{getReasoningSummary(entry, t('chat.thinking'), t('chat.reasoningTrace'))}</span>
      </span>
      <span className="reasoning-rail-meta">
        <span>{t('chat.stepCount', { count: stepCount })}</span>
        <span>{t('chat.toolCount', { count: toolCount })}</span>
        <span className="reasoning-rail-caret" aria-hidden="true">
          {expanded ? '–' : '+'}
        </span>
      </span>
    </button>
  );
};

const UserEntry: React.FC<{ entry: ConversationMessage; fallbackMode: AgentMode }> = ({ entry, fallbackMode }) => {
  const { language, t } = useI18n();
  const mode = resolveEntryMode(entry, fallbackMode);

  return (
    <div className="chat-message user">
      <div className="message-avatar user">U</div>
      <div className="message-content-wrapper">
        <div className="message-header">
          <span className="message-author">{t('chat.you')}</span>
          <MessageModeBadge mode={mode} />
          <span className="message-time">{formatTime(entry.createdAt, language)}</span>
        </div>
        {entry.content ? <div className="message-bubble user">{entry.content}</div> : null}
        <MessageAttachments attachments={entry.attachments ?? []} align="right" />
      </div>
    </div>
  );
};

const AssistantEntry: React.FC<{
  entry: ConversationMessage;
  fallbackMode: AgentMode;
  expanded: boolean;
  onToggle: () => void;
}> = ({ entry, fallbackMode, expanded, onToggle }) => {
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
  const hasReasoning = Boolean(entry.reasoningTrace && entry.reasoningTrace.steps.length > 0);

  return (
    <div className="chat-message assistant">
      <div
        className={`message-avatar assistant mode-${mode}`}
        style={{ ['--message-mode-accent' as string]: modeConfig.accentColor }}
      >
        <ModeGlyph mode={mode} size={16} strokeWidth={1.9} />
      </div>
      <div className="message-content-wrapper">
        <div className="message-header">
          <span className="message-author">{name}</span>
          <MessageModeBadge mode={mode} />
          <span className="message-time">{formatTime(entry.createdAt, language)}</span>
        </div>

        {hasReasoning ? (
          <div className="message-reasoning-shell">
            <ReasoningRail entry={entry} expanded={expanded} onToggle={onToggle} />
            {expanded ? <ReasoningPanel trace={entry.reasoningTrace!} /> : null}
          </div>
        ) : null}

        {entry.content || entry.status === 'streaming' ? (
          <div className={`message-bubble assistant ${entry.content ? '' : 'is-empty'}`}>{entry.content}</div>
        ) : null}
        <MessageAttachments attachments={entry.attachments ?? []} align="left" />
      </div>
    </div>
  );
};

const SystemEntry: React.FC<{ entry: ConversationMessage }> = ({ entry }) => {
  const { language, t } = useI18n();

  return (
    <div className="chat-message system">
      <div className="message-avatar system">!</div>
      <div className="message-content-wrapper">
        <div className="message-header">
          <span className="message-author">{t('chat.system')}</span>
          <span className="message-time">{formatTime(entry.createdAt, language)}</span>
        </div>
        {entry.content ? <div className="message-bubble system">{entry.content}</div> : null}
        <MessageAttachments attachments={entry.attachments ?? []} />
      </div>
    </div>
  );
};

const TimelineEntry: React.FC<{
  entry: ConversationMessage;
  index: number;
  fallbackMode: AgentMode;
  expanded: boolean;
  onToggle: () => void;
}> = ({
  entry,
  index,
  fallbackMode,
  expanded,
  onToggle,
}) => (
  <div className={`timeline-entry role-${entry.role}`} style={{ animationDelay: `${index * 30}ms` }}>
    {entry.role === 'user' && <UserEntry entry={entry} fallbackMode={fallbackMode} />}
    {entry.role === 'assistant' && (
      <AssistantEntry entry={entry} fallbackMode={fallbackMode} expanded={expanded} onToggle={onToggle} />
    )}
    {entry.role === 'system' && <SystemEntry entry={entry} />}
  </div>
);

export const AgentChat: React.FC<{ mode: AgentMode }> = ({ mode }) => {
  const conversationMessages = useSessionStore((state) => state.conversationMessages);
  const deferredMessages = useDeferredValue(conversationMessages);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef(true);
  const [expandedById, setExpandedById] = useState<Record<string, boolean>>({});

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
  }, [deferredMessages]);

  const handleScroll = () => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    shouldStickToBottomRef.current = distanceFromBottom < STICKY_SCROLL_THRESHOLD;
  };

  const toggleExpanded = (messageId: string) => {
    setExpandedById((current) => ({
      ...current,
      [messageId]: !current[messageId],
    }));
  };

  const renderedMessages = useMemo(() => deferredMessages, [deferredMessages]);
  const isEmpty = renderedMessages.length === 0;

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
        ) : renderedMessages.map((entry, index) => (
          <TimelineEntry
            key={entry.id}
            entry={entry}
            index={index}
            fallbackMode={mode}
            expanded={Boolean(expandedById[entry.id])}
            onToggle={() => toggleExpanded(entry.id)}
          />
        ))}
      </div>
    </div>
  );
};

export default AgentChat;

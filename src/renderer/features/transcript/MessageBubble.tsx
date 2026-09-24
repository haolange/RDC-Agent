import React, { useState } from 'react';
import type {
  ConversationMessage,
  ConversationMessageStatus,
} from '@shared/types/conversation';
import { WorkProcess } from './WorkProcess';
import { MessageActions } from './MessageActions';
import { UserMessageEditForm } from './UserMessageEditForm';
import { useUserMessageRewrite } from './useUserMessageRewrite';
import { MessageAttachments } from './MessageAttachments';
import { MessageMarkdown } from '../../patterns/Markdown/MessageMarkdown';
import { HandoffSuggestionRow } from './HandoffSuggestionRow';
import { SystemMessage } from './SystemMessage';
import { useConversationStore } from '../../stores/conversationStore';
import { useAppSettingsStore } from '../../stores/appSettingsStore';
import { useLayoutStore } from '../../stores/layoutStore';
import { useProjectStore } from '../../stores/projectStore';
import { useI18n } from '../../i18n';
import { useComposerEffectiveModel } from '../../hooks/useComposerEffectiveModel';

interface MessageBubbleProps {
  message: ConversationMessage;
}

const formatClockTime = (epoch: number): string => {
  if (!Number.isFinite(epoch) || epoch <= 0) return '';
  return new Date(epoch).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
};

const StreamingCursor: React.FC = () => (
  <span className="conversation-streaming-cursor" aria-hidden="true" />
);

const renderContentWithCursor = (
  content: string,
  status: ConversationMessageStatus | undefined,
): React.ReactNode => {
  const showCursor = status === 'streaming' || status === 'draft';
  if (!content && showCursor) {
    return (
      <span className="conversation-bubble-streaming-empty">
        <StreamingCursor />
      </span>
    );
  }
  return (
    <>
      <MessageMarkdown content={content} deferHeavyPlugins={showCursor} />
      {showCursor ? <StreamingCursor /> : null}
    </>
  );
};

const MessageMetaBar: React.FC<{
  message: ConversationMessage;
  time: string;
  status?: ConversationMessageStatus;
  onEditResend?: (content: string) => void;
}> = ({
  message,
  time,
  status,
  onEditResend,
}) => {
  const { t } = useI18n();
  const branchState = useConversationStore((state) => state.branchState);
  return (
  <footer className="conversation-message-footer">
    {time ? (
      <span className="conversation-message-time">{time}</span>
    ) : null}
    {status === 'streaming' ? (
      <span className="conversation-message-streaming-tag">{t('chat.messageStreaming')}</span>
    ) : null}
    {status === 'error' ? (
      <span className="conversation-message-status-tag is-error">{t('chat.messageError')}</span>
    ) : null}
    {status === 'stopped' ? (
      <span className="conversation-message-status-tag is-stopped">{t('chat.messageStopped')}</span>
    ) : null}
    <MessageActions message={message} branchState={branchState} onEditResend={onEditResend} />
  </footer>
  );
};

const UserBubble: React.FC<{ message: ConversationMessage }> = ({ message }) => {
  const time = formatClockTime(message.createdAt);
  const composerMarkdown = useAppSettingsStore((state) => state.settings.appearance.composerMarkdown);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const [editError, setEditError] = useState('');
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);
  const rewriteMessage = useUserMessageRewrite(message);
  const { t } = useI18n();
  const selectedAgentId = useLayoutStore((state) => state.selectedAgentId);
  const agentDefinitions = useAppSettingsStore((state) => state.settings.agents.definitions);
  const selectedAgent = agentDefinitions.find((agent) => agent.id === selectedAgentId);
  const currentSession = useProjectStore((state) => state.currentSession);
  const { effective } = useComposerEffectiveModel(selectedAgentId, currentSession);
  const executionPreview = t('chat.rewriteWillUse', {
    agent: selectedAgent?.name ?? selectedAgentId,
    provider: effective?.providerId ?? '—',
    model: effective?.modelId ?? '—',
  });

  const beginEdit = () => {
    setDraft(message.content);
    setEditError('');
    setIsEditing(true);
  };

  const cancelEdit = () => {
    setDraft(message.content);
    setEditError('');
    setIsEditing(false);
  };

  const submitEdit = async () => {
    const nextContent = draft.trim();
    if (!nextContent || isSubmittingEdit) return;
    setIsSubmittingEdit(true);
    setEditError('');
    // Close the editor immediately; optimistic rewrite snapshot drives the UI.
    setIsEditing(false);

    try {
      await rewriteMessage(nextContent);
    } catch (error) {
      setDraft(nextContent);
      setIsEditing(true);
      setEditError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSubmittingEdit(false);
    }
  };

  return (
    <article
      className={`conversation-message conversation-message-user ${isEditing ? 'conversation-message-editing' : ''}`}
      data-testid="message-bubble-user"
      data-message-id={message.id}
    >
      <div className="conversation-message-row">
        <div className="conversation-message-stack">
          {message.attachments && message.attachments.length > 0 ? (
            <MessageAttachments attachments={message.attachments} />
          ) : null}
          {isEditing ? (
            <UserMessageEditForm
              value={draft}
              error={editError}
              submitting={isSubmittingEdit}
              executionPreview={executionPreview}
              onChange={setDraft}
              onCancel={cancelEdit}
              onSubmit={() => void submitEdit()}
            />
          ) : (
            <>
              <div className="conversation-bubble conversation-bubble-user">
                {composerMarkdown ? (
                  <MessageMarkdown content={message.content} />
                ) : (
                  <span className="conversation-bubble-text">{message.content}</span>
                )}
              </div>
              <MessageMetaBar
                message={message}
                time={time}
                onEditResend={beginEdit}
              />
            </>
          )}
        </div>
      </div>
    </article>
  );
};

const AssistantBubble: React.FC<{ message: ConversationMessage }> = ({ message }) => {
  const agentId = message.agentId;
  const time = formatClockTime(message.createdAt);
  const trace = message.workTrace ?? null;
  const status: ConversationMessageStatus = message.status ?? 'complete';
  const isInProgress = status === 'streaming' || status === 'draft';
  const hasContent = Boolean(message.content && message.content.length > 0);
  const traceIsRunning = Boolean(trace && trace.status === 'running');
  // Work Process remains first, while the assistant answer streams underneath it.
  const showContentBubble = hasContent || isInProgress || traceIsRunning;
  // 诊断文案已由气泡正文承载时不再重复渲染独立诊断块，避免同一信息三重显示。
  const showDiagnosticBlock = Boolean(
    message.diagnostic
    && message.diagnostic.userMessage.trim() !== (message.content ?? '').trim(),
  );
  return (
    <article
      className={`conversation-message conversation-message-assistant status-${status}`}
      data-testid="message-bubble-assistant"
      data-message-id={message.id}
      data-agent-id={agentId ?? 'assistant'}
    >
      <div className="conversation-message-row">
        <div className="conversation-message-stack">
          {trace && ((trace.blocks?.length ?? 0) > 0 || trace.summary || trace.status === 'running') ? (
              <WorkProcess trace={trace} sessionId={message.sessionId} />
          ) : null}
          {message.attachments && message.attachments.length > 0 ? (
            <MessageAttachments attachments={message.attachments} />
          ) : null}
          {showContentBubble ? (
            <div className="conversation-bubble conversation-bubble-assistant">
              {renderContentWithCursor(message.content, status)}
            </div>
          ) : null}
          {!isInProgress && message.handoffSuggestions && message.handoffSuggestions.length > 0 ? (
            <HandoffSuggestionRow suggestions={message.handoffSuggestions} />
          ) : null}
          {showDiagnosticBlock && message.diagnostic ? (
            <div className="conversation-message-diagnostic" role="alert">
              <span className="conversation-message-diagnostic-code">
                {message.diagnostic.code}
              </span>
              <span className="conversation-message-diagnostic-text">
                {message.diagnostic.userMessage}
              </span>
            </div>
          ) : null}
          {!isInProgress ? (
            <MessageMetaBar message={message} time={time} status={status} />
          ) : null}
        </div>
      </div>
    </article>
  );
};

const MessageBubbleInner: React.FC<MessageBubbleProps> = ({ message }) => {
  if (message.role === 'user') {
    return <UserBubble message={message} />;
  }
  if (message.role === 'assistant') {
    return <AssistantBubble message={message} />;
  }
  return <SystemMessage message={message} />;
};

export const MessageBubble = React.memo(MessageBubbleInner);

export default MessageBubble;

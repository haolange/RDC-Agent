import React, { useMemo, useState } from 'react';
import type {
  ConversationMessage,
  ConversationMessageStatus,
} from '@shared/types/conversation';
import { resolveAgentDisplay } from '@shared/constants/agents';
import { useAppSettingsStore } from '../../../stores/appSettingsStore';
import { WorkProcess } from './WorkProcess';
import { useAgentHandoffActions } from './useAgentHandoffActions';
import { MessageActions } from './MessageActions';
import { ModeGlyph } from '../../../ui/ModeGlyph';
import { UserMessageEditForm } from './UserMessageEditForm';
import { useUserMessageRewrite } from './useUserMessageRewrite';
import { MessageAttachments } from './MessageAttachments';

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
      <span className="conversation-bubble-text">{content}</span>
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
}) => (
  <footer className="conversation-message-footer">
    {time ? (
      <span className="conversation-message-time">{time}</span>
    ) : null}
    {status === 'streaming' ? (
      <span className="conversation-message-streaming-tag">streaming</span>
    ) : null}
    {status === 'error' ? (
      <span className="conversation-message-status-tag is-error">error</span>
    ) : null}
    {status === 'stopped' ? (
      <span className="conversation-message-status-tag is-stopped">stopped</span>
    ) : null}
    <MessageActions message={message} onEditResend={onEditResend} />
  </footer>
);

const UserBubble: React.FC<{ message: ConversationMessage }> = ({ message }) => {
  const time = formatClockTime(message.createdAt);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const [editError, setEditError] = useState('');
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);
  const rewriteMessage = useUserMessageRewrite(message);

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

    try {
      await rewriteMessage(nextContent);
      setIsEditing(false);
    } catch (error) {
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
              onChange={setDraft}
              onCancel={cancelEdit}
              onSubmit={() => void submitEdit()}
            />
          ) : (
            <>
              <div className="conversation-bubble conversation-bubble-user">
                <span className="conversation-bubble-text">{message.content}</span>
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
  const definitions = useAppSettingsStore((state) => state.settings.agents.definitions);
  const display = resolveAgentDisplay(agentId ?? 'assistant', definitions);
  const accent = display.accent;
  const time = formatClockTime(message.createdAt);
  const trace = message.workTrace ?? null;
  const status: ConversationMessageStatus = message.status ?? 'complete';
  const hasContent = Boolean(message.content && message.content.length > 0);
  const [sendingHandoff, setSendingHandoff] = useState<string | null>(null);
  const sendAgentHandoff = useAgentHandoffActions(message);
  const handoffs = useMemo(() => {
    if (!agentId || status !== 'complete') return [];
    const definition = definitions.find((entry) => entry.id === agentId && entry.enabled);
    return definition?.handoffs ?? [];
  }, [agentId, definitions, status]);

  const styleVar: React.CSSProperties = {
    ['--message-mode-accent' as string]: accent,
  };

  const sendHandoff = async (handoffIndex: number) => {
    const handoff = handoffs[handoffIndex];
    if (!handoff || sendingHandoff) return;
    setSendingHandoff(handoff.label);
    try {
      await sendAgentHandoff(handoff);
    } finally {
      setSendingHandoff(null);
    }
  };

  return (
    <article
      className={`conversation-message conversation-message-assistant status-${status}`}
      data-testid="message-bubble-assistant"
      data-message-id={message.id}
      data-agent-id={agentId ?? 'assistant'}
      style={styleVar}
    >
      <div className="conversation-message-row">
        <div className="conversation-message-stack">
          {trace && (trace.blocks.length > 0 || trace.summary || trace.status === 'running') ? (
            <WorkProcess trace={trace} />
          ) : null}
          {message.attachments && message.attachments.length > 0 ? (
            <MessageAttachments attachments={message.attachments} />
          ) : null}
          {hasContent || status === 'streaming' || status === 'draft' ? (
            <div className="conversation-bubble conversation-bubble-assistant">
              {renderContentWithCursor(message.content, status)}
            </div>
          ) : null}
          {message.diagnostic ? (
            <div className="conversation-message-diagnostic" role="alert">
              <span className="conversation-message-diagnostic-code">
                {message.diagnostic.code}
              </span>
              <span className="conversation-message-diagnostic-text">
                {message.diagnostic.userMessage}
              </span>
            </div>
          ) : null}
          <MessageMetaBar message={message} time={time} status={status} />
          {handoffs.length > 0 ? (
            <div className="conversation-handoff-actions" data-testid="conversation-handoff-actions">
              <span className="conversation-handoff-actions-label">Next actions</span>
              <div className="conversation-handoff-button-row">
                {handoffs.map((handoff, index) => {
                  const target = resolveAgentDisplay(handoff.agent, definitions);
                  return (
                    <button
                      key={`${handoff.agent}-${handoff.label}-${index}`}
                      type="button"
                      className="conversation-handoff-button"
                      disabled={Boolean(sendingHandoff)}
                      data-testid={`conversation-handoff-${handoff.agent}`}
                      onClick={() => {
                        void sendHandoff(index);
                      }}
                      title={`${handoff.prompt}\nTarget: ${target.name}`}
                      aria-label={`${handoff.label} (${target.name})`}
                    >
                      <span className="conversation-handoff-button-icon" aria-hidden="true">
                        <ModeGlyph mode={handoff.agent} icon={target.icon} accentColor={target.accent} size={14} strokeWidth={1.9} />
                      </span>
                      <span>{handoff.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
};

const SystemBubble: React.FC<{ message: ConversationMessage }> = ({ message }) => (
  <article
    className="conversation-message conversation-message-system"
    data-testid="message-bubble-system"
    data-message-id={message.id}
  >
    <div className="conversation-bubble conversation-bubble-system">
      <span className="conversation-bubble-text">{message.content}</span>
    </div>
  </article>
);

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
  if (message.role === 'user') {
    return <UserBubble message={message} />;
  }
  if (message.role === 'assistant') {
    return <AssistantBubble message={message} />;
  }
  return <SystemBubble message={message} />;
};

export default MessageBubble;

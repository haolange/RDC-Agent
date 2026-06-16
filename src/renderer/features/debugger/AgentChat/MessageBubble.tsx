import React, { useMemo, useState } from 'react';
import type {
  ConversationMessage,
  ConversationMessageStatus,
} from '@shared/types/conversation';
import type { SessionAttachmentRecord } from '@shared/types/session';
import { formatBytes } from '../../../services/attachmentHelpers';
import { resolveAgentDisplay } from '@shared/constants/agents';
import { useAppSettingsStore } from '../../../stores/appSettingsStore';
import { WorkProcess } from './WorkProcess';
import { useAgentHandoffActions } from './useAgentHandoffActions';

interface MessageBubbleProps {
  message: ConversationMessage;
}

const formatClockTime = (epoch: number): string => {
  if (!Number.isFinite(epoch) || epoch <= 0) return '';
  return new Date(epoch).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
};

const isImageAttachment = (attachment: SessionAttachmentRecord): boolean =>
  attachment.kind === 'image' || /^image\//i.test(attachment.mimeType ?? '');

const AttachmentList: React.FC<{ attachments: SessionAttachmentRecord[] }> = ({
  attachments,
}) => (
  <div className="message-attachments" data-testid="message-attachments">
    {attachments.map((attachment) => {
      const image = isImageAttachment(attachment);
      const ext = attachment.fileName.includes('.')
        ? attachment.fileName.slice(attachment.fileName.lastIndexOf('.') + 1).toUpperCase()
        : 'FILE';
      return (
        <div
          key={attachment.attachmentId}
          className={`message-attachment-pill ${image ? 'image' : ''}`.trim()}
        >
          <span className="message-attachment-pill-icon" aria-hidden="true">
            {image ? '◫' : ext.slice(0, 4)}
          </span>
          <span className="message-attachment-pill-copy">
            <span className="message-attachment-pill-name">{attachment.fileName}</span>
            <span className="message-attachment-pill-meta">
              {formatBytes(attachment.size)}
            </span>
          </span>
        </div>
      );
    })}
  </div>
);

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

const UserBubble: React.FC<{ message: ConversationMessage }> = ({ message }) => {
  const time = formatClockTime(message.createdAt);
  return (
    <article
      className="conversation-message conversation-message-user"
      data-testid="message-bubble-user"
      data-message-id={message.id}
    >
      <div className="conversation-message-row">
        <div className="conversation-message-stack">
          <header className="conversation-message-header">
            <span className="conversation-message-author">You</span>
            {time ? (
              <span className="conversation-message-time">{time}</span>
            ) : null}
          </header>
          {message.attachments && message.attachments.length > 0 ? (
            <AttachmentList attachments={message.attachments} />
          ) : null}
          <div className="conversation-bubble conversation-bubble-user">
            <span className="conversation-bubble-text">{message.content}</span>
          </div>
        </div>
        <div className="conversation-avatar conversation-avatar-user" aria-hidden="true">
          U
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
  const displayName = display.name;
  const glyph = display.glyph;
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
        <div className="conversation-avatar conversation-avatar-assistant" aria-hidden="true">
          <span className="conversation-avatar-glyph">{glyph}</span>
        </div>
        <div className="conversation-message-stack">
          <header className="conversation-message-header">
            <span className="conversation-message-author">{displayName}</span>
            {status === 'streaming' ? (
              <span className="conversation-message-streaming-tag">streaming</span>
            ) : null}
            {status === 'error' ? (
              <span className="conversation-message-status-tag is-error">error</span>
            ) : null}
            {status === 'stopped' ? (
              <span className="conversation-message-status-tag is-stopped">stopped</span>
            ) : null}
            {time ? (
              <span className="conversation-message-time">{time}</span>
            ) : null}
          </header>
          {trace && (trace.blocks.length > 0 || trace.summary || trace.status === 'running') ? (
            <WorkProcess trace={trace} />
          ) : null}
          {message.attachments && message.attachments.length > 0 ? (
            <AttachmentList attachments={message.attachments} />
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
                        {target.glyph}
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

import React from 'react';
import type {
  ConversationMessage,
  ConversationMessageStatus,
} from '@shared/types/conversation';
import type { AgentRole } from '@shared/types/agent';
import type { SessionAttachmentRecord } from '@shared/types/session';
import { formatBytes } from '../../../services/attachmentHelpers';
import { ReasoningChain } from './ReasoningChain';

interface MessageBubbleProps {
  message: ConversationMessage;
}

const AGENT_DISPLAY_NAME: Record<AgentRole, string> = {
  ask_agent: 'Ask',
  'rdc-debugger': 'Debugger',
  triage_agent: 'Triage',
  capture_repro_agent: 'Capture',
  pass_graph_pipeline_agent: 'Pipeline',
  pixel_forensics_agent: 'Pixel',
  shader_ir_agent: 'Shader',
  driver_device_agent: 'Driver',
  skeptic_agent: 'Skeptic',
  curator_agent: 'Curator',
};

const AGENT_AVATAR_GLYPH: Record<AgentRole, string> = {
  ask_agent: 'AS',
  'rdc-debugger': 'DG',
  triage_agent: 'TR',
  capture_repro_agent: 'CR',
  pass_graph_pipeline_agent: 'PG',
  pixel_forensics_agent: 'PF',
  shader_ir_agent: 'SH',
  driver_device_agent: 'DV',
  skeptic_agent: 'SK',
  curator_agent: 'CU',
};

const AGENT_ACCENT: Record<AgentRole, string> = {
  ask_agent: '#33d1ff',
  'rdc-debugger': '#33d1ff',
  triage_agent: '#fbbf24',
  capture_repro_agent: '#a8ff60',
  pass_graph_pipeline_agent: '#7ed1ff',
  pixel_forensics_agent: '#ff8fbf',
  shader_ir_agent: '#c19bff',
  driver_device_agent: '#ffb38a',
  skeptic_agent: '#ff8a8a',
  curator_agent: '#9be8c2',
};

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
  const accent = agentId ? AGENT_ACCENT[agentId] : '#33d1ff';
  const displayName = agentId ? AGENT_DISPLAY_NAME[agentId] : 'Assistant';
  const glyph = agentId ? AGENT_AVATAR_GLYPH[agentId] : 'AI';
  const time = formatClockTime(message.createdAt);
  const trace = message.reasoningTrace ?? null;
  const status: ConversationMessageStatus = message.status ?? 'complete';
  const hasContent = Boolean(message.content && message.content.length > 0);

  const styleVar: React.CSSProperties = {
    ['--message-mode-accent' as string]: accent,
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
          {trace && (trace.steps.length > 0 || trace.summary || trace.status === 'running') ? (
            <ReasoningChain trace={trace} />
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

import React, { useEffect, useRef } from 'react';
import { AGENT_DISPLAY_NAMES, getAgentModeConfig } from '@shared/constants/agents';
import type { AgentRole } from '@shared/types/agent';
import type { AgentMode } from '@shared/types/layout';
import type { ConversationMessage } from '@shared/types/conversation';
import type { SessionAttachmentRecord } from '@shared/types/session';
import { useSessionStore } from '../../stores/sessionStore';
import { EmptyWorkbenchPrompt } from '../EmptyWorkbenchPrompt';
import { ModeGlyph } from '../ModeGlyph';
import './AgentChat.css';

const formatTime = (timestamp: number): string =>
  new Date(timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

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

const resolveEntryMode = (entry: ConversationMessage, fallbackMode: AgentMode): AgentMode =>
  entry.modeContext ?? fallbackMode;

const MessageModeBadge: React.FC<{ mode: AgentMode }> = ({ mode }) => {
  const modeConfig = getAgentModeConfig(mode);

  return (
    <span className="message-mode-badge" style={{ ['--message-mode-accent' as string]: modeConfig.accentColor }}>
      <ModeGlyph mode={mode} className="message-mode-badge-icon" size={12} strokeWidth={1.9} />
      <span>{modeConfig.label}</span>
    </span>
  );
};

const UserEntry: React.FC<{ entry: ConversationMessage; fallbackMode: AgentMode }> = ({ entry, fallbackMode }) => {
  const mode = resolveEntryMode(entry, fallbackMode);

  return (
    <div className="chat-message user">
      <div className="message-avatar user">U</div>
    <div className="message-content-wrapper">
      <div className="message-header">
        <span className="message-author">You</span>
        <MessageModeBadge mode={mode} />
        <span className="message-time">{formatTime(entry.createdAt)}</span>
      </div>
      {entry.content ? <div className="message-bubble user">{entry.content}</div> : null}
      <MessageAttachments attachments={entry.attachments ?? []} />
    </div>
  </div>
  );
};

const AssistantEntry: React.FC<{ entry: ConversationMessage; fallbackMode: AgentMode }> = ({ entry, fallbackMode }) => {
  const role = entry.agentId as AgentRole | undefined;
  const mode = resolveEntryMode(entry, fallbackMode);
  const modeConfig = getAgentModeConfig(mode);
  const name = role === 'rdc-debugger'
    ? modeConfig.label
    : role
      ? (AGENT_DISPLAY_NAMES[role] ?? role)
      : modeConfig.label;

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
          <span className="message-time">{formatTime(entry.createdAt)}</span>
        </div>
        {entry.content ? <div className="message-bubble assistant">{entry.content}</div> : null}
        <MessageAttachments attachments={entry.attachments ?? []} />
      </div>
    </div>
  );
};

const SystemEntry: React.FC<{ entry: ConversationMessage }> = ({ entry }) => (
  <div className="chat-message system">
    <div className="message-avatar system">!</div>
    <div className="message-content-wrapper">
      <div className="message-header">
        <span className="message-author">System</span>
        <span className="message-time">{formatTime(entry.createdAt)}</span>
      </div>
      {entry.content ? <div className="message-bubble system">{entry.content}</div> : null}
      <MessageAttachments attachments={entry.attachments ?? []} />
    </div>
  </div>
);

const TimelineEntry: React.FC<{ entry: ConversationMessage; index: number; fallbackMode: AgentMode }> = ({
  entry,
  index,
  fallbackMode,
}) => (
  <div className="timeline-entry" style={{ animationDelay: `${index * 30}ms` }}>
    {entry.role === 'user' && <UserEntry entry={entry} fallbackMode={fallbackMode} />}
    {entry.role === 'assistant' && <AssistantEntry entry={entry} fallbackMode={fallbackMode} />}
    {entry.role === 'system' && <SystemEntry entry={entry} />}
  </div>
);

export const AgentChat: React.FC<{ mode: AgentMode }> = ({ mode }) => {
  const conversationMessages = useSessionStore((state) => state.conversationMessages);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (navigator.webdriver) {
      return;
    }
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversationMessages]);

  return (
    <div className="agent-chat" data-testid="agent-chat">
      <div
        className={`chat-messages scrollbar-thin ${conversationMessages.length === 0 ? 'chat-messages-empty' : ''}`}
        data-testid="chat-messages"
      >
        {conversationMessages.length === 0 ? (
          <EmptyWorkbenchPrompt mode={mode} />
        ) : conversationMessages.map((entry, index) => (
          <TimelineEntry key={entry.id} entry={entry} index={index} fallbackMode={mode} />
        ))}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
};

export default AgentChat;

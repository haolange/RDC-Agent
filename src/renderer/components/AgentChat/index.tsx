import React, { useEffect, useRef } from 'react';
import { AGENT_DISPLAY_NAMES } from '@shared/constants/agents';
import type { AgentRole } from '@shared/types/agent';
import type { ConversationMessage } from '@shared/types/conversation';
import { useSessionStore } from '../../stores/sessionStore';
import './AgentChat.css';

const formatTime = (timestamp: number): string =>
  new Date(timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

const UserEntry: React.FC<{ entry: ConversationMessage }> = ({ entry }) => (
  <div className="chat-message user">
    <div className="message-avatar user">U</div>
    <div className="message-content-wrapper">
      <div className="message-header">
        <span className="message-author">You</span>
        <span className="message-time">{formatTime(entry.createdAt)}</span>
      </div>
      <div className="message-bubble user">{entry.content}</div>
    </div>
  </div>
);

const AssistantEntry: React.FC<{ entry: ConversationMessage }> = ({ entry }) => {
  const role = entry.agentId as AgentRole | undefined;
  const initial = role ? (AGENT_DISPLAY_NAMES[role]?.charAt(0) ?? 'A') : 'A';
  const name = role ? (AGENT_DISPLAY_NAMES[role] ?? role) : 'Assistant';

  return (
    <div className="chat-message assistant">
      <div className="message-avatar assistant">{initial}</div>
      <div className="message-content-wrapper">
        <div className="message-header">
          <span className="message-author">{name}</span>
          <span className="message-time">{formatTime(entry.createdAt)}</span>
        </div>
        <div className="message-bubble assistant">{entry.content}</div>
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
      <div className="message-bubble system">
        {entry.content}
      </div>
    </div>
  </div>
);

const TimelineEntry: React.FC<{ entry: ConversationMessage; index: number }> = ({ entry, index }) => (
  <div className="timeline-entry" style={{ animationDelay: `${index * 30}ms` }}>
    {entry.role === 'user' && <UserEntry entry={entry} />}
    {entry.role === 'assistant' && <AssistantEntry entry={entry} />}
    {entry.role === 'system' && <SystemEntry entry={entry} />}
  </div>
);

export const AgentChat: React.FC = () => {
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
      <div className="chat-messages scrollbar-thin" data-testid="chat-messages">
        {conversationMessages.length === 0 ? (
          <div className="chat-empty-state">
            <h3 className="chat-empty-title">先聊清楚，再决定是否进入正式调试</h3>
            <p className="chat-empty-description">
              你可以先问我是谁、我能做什么，或者直接描述现象。只有在你明确要开始分析，并且 capture 与模型链路都准备好时，我才会进入严格的 RenderDoc 调试流程。
            </p>
          </div>
        ) : conversationMessages.map((entry, index) => (
          <TimelineEntry key={entry.id} entry={entry} index={index} />
        ))}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
};

export default AgentChat;

import React, { useCallback, useEffect, useRef } from 'react';
import { AGENT_DISPLAY_NAMES } from '@shared/constants/agents';
import type { AgentRole, AgentTimelineEntry } from '@shared/types/agent';
import { useSessionStore } from '../../stores/sessionStore';
import './AgentChat.css';

const formatTime = (timestamp: number): string =>
  new Date(timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

const UserEntry: React.FC<{ entry: AgentTimelineEntry }> = ({ entry }) => (
  <div className="chat-message user">
    <div className="message-avatar user">U</div>
    <div className="message-content-wrapper">
      <div className="message-header">
        <span className="message-author">You</span>
        <span className="message-time">{formatTime(entry.timestamp)}</span>
      </div>
      <div className="message-bubble user">{entry.content}</div>
    </div>
  </div>
);

const AgentEntry: React.FC<{ entry: AgentTimelineEntry }> = ({ entry }) => {
  const role = entry.agentRole as AgentRole | undefined;
  const initial = role ? (AGENT_DISPLAY_NAMES[role]?.charAt(0) ?? 'A') : 'A';
  const name = role ? (AGENT_DISPLAY_NAMES[role] ?? role) : 'Agent';
  return (
    <div className="chat-message assistant">
      <div className="message-avatar assistant">{initial}</div>
      <div className="message-content-wrapper">
        <div className="message-header">
          <span className="message-author">{name}</span>
          <span className="message-time">{formatTime(entry.timestamp)}</span>
        </div>
        <div className="message-bubble assistant">{entry.content}</div>
      </div>
    </div>
  );
};

const ToolCallEntry: React.FC<{ entry: AgentTimelineEntry }> = ({ entry }) => (
  <div className="chat-message system">
    <div className="message-avatar system">T</div>
    <div className="message-content-wrapper">
      <div className="message-header">
        <span className="message-author">{entry.title || 'Tool'}</span>
        <span className="message-time">{formatTime(entry.timestamp)}</span>
      </div>
      <div className="message-bubble system">
        {entry.content}
        {entry.status && <div className="tool-call-status">{entry.status}</div>}
      </div>
    </div>
  </div>
);

const StructuredEntry: React.FC<{ entry: AgentTimelineEntry }> = ({ entry }) => (
  <div className={`chat-message ${entry.type === 'reasoning' ? 'assistant' : 'system'} ${entry.type === 'blocker' ? 'chat-message--blocker' : ''}`}>
    <div className="message-avatar system">
      {entry.type === 'reasoning' ? 'R' : entry.type === 'stage' ? 'S' : entry.type === 'dispatch' ? 'D' : entry.type === 'verification' ? 'V' : entry.type === 'report' ? 'P' : '!'}
    </div>
    <div className="message-content-wrapper">
      <div className="message-header">
        <span className="message-author">{entry.title || 'System'}</span>
        <span className="message-time">{formatTime(entry.timestamp)}</span>
      </div>
      <div className="message-bubble system">
        {entry.content}
        {entry.reasoningSummary && (
          <div className="message-tools">
            <div>Evidence: {(entry.reasoningSummary.evidence ?? []).join(' | ') || 'N/A'}</div>
            <div>Next step: {entry.reasoningSummary.nextStep || 'N/A'}</div>
            <div>Confidence: {Math.round((entry.reasoningSummary.confidence || 0) * 100)}%</div>
          </div>
        )}
      </div>
    </div>
  </div>
);

const TimelineEntry: React.FC<{ entry: AgentTimelineEntry; index: number }> = ({ entry, index }) => (
  <div className="timeline-entry" style={{ animationDelay: `${index * 30}ms` }}>
    {entry.type === 'user' && <UserEntry entry={entry} />}
    {entry.type === 'agent' && <AgentEntry entry={entry} />}
    {entry.type === 'tool_call' && <ToolCallEntry entry={entry} />}
    {['reasoning', 'blocker', 'system', 'stage', 'dispatch', 'verification', 'report'].includes(entry.type) && (
      <StructuredEntry entry={entry} />
    )}
  </div>
);

export const AgentChat: React.FC = () => {
  const timeline = useSessionStore((state) => state.timeline);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (navigator.webdriver) {
      return;
    }
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [timeline]);

  const clearTimeline = useCallback(() => {
    useSessionStore.getState().setTimeline([]);
  }, []);

  return (
    <div className="agent-chat" data-testid="agent-chat">
      <div className="chat-header">
        <div className="chat-header-left">
          <div className="chat-agent-selector">
            <div className="chat-agent-avatar debugger">R</div>
            <div className="chat-agent-info">
              <span className="chat-agent-name">RDC Debugger</span>
              <span className="chat-agent-role">Structured event flow</span>
            </div>
          </div>
        </div>
        <div className="chat-header-actions">
          <button
            className="icon-button tooltip"
            data-tooltip="Clear timeline"
            onClick={clearTimeline}
            aria-label="Clear timeline"
            type="button"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="chat-messages scrollbar-thin" data-testid="chat-messages">
        {timeline.length === 0 ? (
          <div className="chat-empty-state">
            <h3 className="chat-empty-title">Task timeline is waiting for the first event</h3>
            <p className="chat-empty-description">
              Plan, dispatch, tools, verification, and reports will appear here in order.
            </p>
          </div>
        ) : timeline.map((entry, index) => (
          <TimelineEntry key={entry.id} entry={entry} index={index} />
        ))}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
};

export default AgentChat;

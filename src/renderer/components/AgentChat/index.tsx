import React, { useCallback, useEffect, useRef } from 'react';
import { AGENT_DISPLAY_NAMES } from '@shared/constants/agents';
import type { AgentRole, AgentTimelineEntry } from '@shared/types/agent';
import { useSessionStore } from '../../stores/sessionStore';
import './AgentChat.css';

// ────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────

const formatTime = (timestamp: number): string =>
  new Date(timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

// ────────────────────────────────────────────────────────
// Timeline entry renderers
// ────────────────────────────────────────────────────────

const UserEntry: React.FC<{ entry: AgentTimelineEntry }> = ({ entry }) => (
  <div className="chat-message user">
    <div className="message-avatar user">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    </div>
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

const ToolCallEntry: React.FC<{ entry: AgentTimelineEntry }> = ({ entry }) => {
  const trace = entry.toolTrace;
  const success = trace?.result?.ok !== false;
  return (
    <div className="chat-message system">
      <div className="message-avatar system">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </svg>
      </div>
      <div className="message-content-wrapper">
        <div className="message-header">
          <span className="message-author">Tool</span>
          <span className="message-time">{formatTime(entry.timestamp)}</span>
        </div>
        <div className="message-tools">
          <div className="tool-call">
            <svg className="tool-call-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
            </svg>
            <span className="tool-call-name">{entry.content}</span>
            <span className={`tool-call-status ${success ? 'success' : 'error'}`}>
              {success ? 'Done' : 'Failed'}
            </span>
            {trace && (
              <span className="tool-call-duration">{trace.result.duration_ms}ms</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const BlockerEntry: React.FC<{ entry: AgentTimelineEntry }> = ({ entry }) => (
  <div className="chat-message system chat-message--blocker">
    <div className="message-avatar system">!</div>
    <div className="message-content-wrapper">
      <div className="message-header">
        <span className="message-author">Blocker</span>
        <span className="message-time">{formatTime(entry.timestamp)}</span>
      </div>
      <div className="message-bubble system">
        {entry.content}
      </div>
    </div>
  </div>
);

const SystemEntry: React.FC<{ entry: AgentTimelineEntry }> = ({ entry }) => (
  <div className="chat-message system">
    <div className="message-avatar system">·</div>
    <div className="message-content-wrapper">
      <div className="message-header">
        <span className="message-author">System</span>
        <span className="message-time">{formatTime(entry.timestamp)}</span>
      </div>
      <div className="message-bubble system">{entry.content}</div>
    </div>
  </div>
);

const TimelineEntry: React.FC<{ entry: AgentTimelineEntry; index: number }> = ({ entry, index }) => (
  <div className="timeline-entry" style={{ animationDelay: `${index * 30}ms` }}>
    {entry.type === 'user' && <UserEntry entry={entry} />}
    {entry.type === 'agent' && <AgentEntry entry={entry} />}
    {entry.type === 'tool_call' && <ToolCallEntry entry={entry} />}
    {entry.type === 'blocker' && <BlockerEntry entry={entry} />}
    {entry.type === 'system' && <SystemEntry entry={entry} />}
  </div>
);

// ────────────────────────────────────────────────────────
// Main component
// ────────────────────────────────────────────────────────

export const AgentChat: React.FC = () => {
  const timeline = useSessionStore((s) => s.timeline);

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
              <span className="chat-agent-role">Task Timeline</span>
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
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18" />
              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
            </svg>
          </button>
        </div>
      </div>

      <div className="chat-messages scrollbar-thin" data-testid="chat-messages">
        {timeline.length === 0 ? (
          <div className="chat-empty-state">
            <svg className="chat-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <h3 className="chat-empty-title">Task timeline is waiting for the first event</h3>
            <p className="chat-empty-description">
              Agent reasoning, tool calls, blockers, and system messages will append here after the task starts running.
            </p>
          </div>
        ) : (
          <>
            {timeline.map((entry, index) => (
              <TimelineEntry key={entry.id} entry={entry} index={index} />
            ))}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
};

export default AgentChat;

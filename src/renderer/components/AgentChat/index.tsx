import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  <div className="chat-message system" style={{ '--blocker-accent': 'rgb(239,68,68)' } as React.CSSProperties}>
    <div className="message-avatar system" style={{ background: 'rgb(239,68,68,0.15)', color: 'rgb(239,68,68)' }}>!</div>
    <div className="message-content-wrapper">
      <div className="message-header">
        <span className="message-author" style={{ color: 'rgb(239,68,68)' }}>Blocker</span>
        <span className="message-time">{formatTime(entry.timestamp)}</span>
      </div>
      <div className="message-bubble system" style={{ borderColor: 'rgb(239,68,68,0.3)' }}>
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
  <div style={{ animationDelay: `${index * 30}ms` }}>
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

const QUICK_ACTIONS = [
  { icon: 'Investigate', label: 'Trace pipeline state', prompt: 'Trace the pipeline state around the failing draw call.' },
  { icon: 'Compare', label: 'Compare captures', prompt: 'Compare the anomalous capture against the baseline and summarize differences.' },
  { icon: 'Hypothesis', label: 'Form hypotheses', prompt: 'List the most likely hypotheses and the evidence needed to verify each one.' },
  { icon: 'Report', label: 'Summarize evidence', prompt: 'Summarize the current evidence chain and remaining gaps.' },
];

const SUGGESTIONS = [
  'What is the first suspicious render event in this capture?',
  'Which pipeline state differences are most likely to explain the artifact?',
  'Check whether the issue is shader, resource, or pass-order related.',
  'Summarize the next three investigation steps.',
];

export const AgentChat: React.FC = () => {
  const timeline = useSessionStore((s) => s.timeline);
  const addTimelineEntry = useSessionStore((s) => s.addTimelineEntry);

  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(true);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [timeline, isTyping, scrollToBottom]);

  const submitMessage = useCallback(
    async (content: string) => {
      const trimmed = content.trim();
      if (!trimmed) return;

      const userEntry: AgentTimelineEntry = {
        id: `user-${Date.now()}`,
        type: 'user',
        content: trimmed,
        timestamp: Date.now(),
      };
      addTimelineEntry(userEntry);
      setInputValue('');
      setShowSuggestions(false);
      setIsTyping(true);

      const electronAPI = window.electronAPI;
      if (!electronAPI?.agent?.sendMessage) {
        addTimelineEntry({
          id: `sys-${Date.now()}`,
          type: 'system',
          content: 'Agent backend is unavailable. Launch from the Electron shell to send messages.',
          timestamp: Date.now(),
        });
        setIsTyping(false);
        return;
      }

      try {
        const result = await electronAPI.agent.sendMessage('rdc-debugger', trimmed);
        if (result.error) {
          addTimelineEntry({
            id: `sys-${Date.now()}`,
            type: 'system',
            content: result.error || 'Agent request failed.',
            timestamp: Date.now(),
          });
        }
      } catch (err) {
        addTimelineEntry({
          id: `sys-${Date.now()}`,
          type: 'system',
          content: err instanceof Error ? err.message : 'Agent request failed.',
          timestamp: Date.now(),
        });
      } finally {
        setIsTyping(false);
      }
    },
    [addTimelineEntry]
  );

  const handleSend = useCallback(() => void submitMessage(inputValue), [inputValue, submitMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const clearTimeline = useCallback(() => {
    useSessionStore.getState().setTimeline([]);
    setInputValue('');
    setShowSuggestions(true);
    setIsTyping(false);
  }, []);

  return (
    <div className="agent-chat">
      <div className="chat-header">
        <div className="chat-header-left">
          <div className="chat-agent-selector">
            <div className="chat-agent-avatar debugger">R</div>
            <div className="chat-agent-info">
              <span className="chat-agent-name">RDC Debugger</span>
              <span className="chat-agent-role">Orchestration timeline</span>
            </div>
          </div>
        </div>
        <div className="chat-header-actions">
          <button className="icon-button tooltip" data-tooltip="Clear timeline" onClick={clearTimeline}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18" />
              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
            </svg>
          </button>
        </div>
      </div>

      <div className="chat-messages scrollbar-thin">
        {timeline.length === 0 && showSuggestions ? (
          <div className="chat-empty-state">
            <svg className="chat-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <h3 className="chat-empty-title">Orchestration timeline</h3>
            <p className="chat-empty-description">
              Agent messages, tool calls, blockers, and system events will stream here in real time.
            </p>
            <div className="chat-empty-suggestions">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  className="chat-suggestion-chip"
                  onClick={() => setInputValue(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {timeline.map((entry, index) => (
              <TimelineEntry key={entry.id} entry={entry} index={index} />
            ))}
            {isTyping && (
              <div className="typing-indicator">
                <div className="message-avatar assistant">R</div>
                <div className="typing-bubble">
                  <span /><span /><span />
                </div>
                <span className="typing-text">RDC Debugger is reasoning...</span>
              </div>
            )}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-quick-actions">
        {QUICK_ACTIONS.map((action) => (
          <button
            key={action.label}
            className="quick-action"
            onClick={() => void submitMessage(action.prompt)}
          >
            <span className="quick-action-copy">{action.icon}</span>
            <span>{action.label}</span>
          </button>
        ))}
      </div>

      <div className="chat-input-container">
        <div className="chat-input-wrapper">
          <textarea
            ref={inputRef}
            className="chat-input"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask the debugger to inspect, compare, or summarize the current evidence..."
            rows={1}
          />
          <div className="chat-input-actions">
            <button
              className="chat-send-button"
              onClick={handleSend}
              disabled={!inputValue.trim() || isTyping}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
        </div>
        <div className="chat-input-hint">
          <span><kbd>Enter</kbd> send</span>
          <span><kbd>Shift</kbd> + <kbd>Enter</kbd> newline</span>
        </div>
      </div>
    </div>
  );
};

export default AgentChat;

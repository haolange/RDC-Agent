import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AGENT_DISPLAY_NAMES } from '@shared/constants/agents';
import type { AgentMessage, AgentRole } from '@shared/types/agent';
import './AgentChat.css';

interface AgentChatProps {
  initialAgent?: AgentRole;
}

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

const createSystemMessage = (activeAgent: AgentRole, content: string): AgentMessage => ({
  id: `sys-${Date.now()}`,
  agentId: activeAgent,
  role: 'system',
  content,
  timestamp: Date.now(),
});

export const AgentChat: React.FC<AgentChatProps> = ({ initialAgent = 'rdc-debugger' }) => {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [activeAgent] = useState<AgentRole>(initialAgent);
  const [isTyping, setIsTyping] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const electronAPI =
    typeof window !== 'undefined'
      ? (window as Window & { electronAPI?: Window['electronAPI'] }).electronAPI
      : undefined;

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping, scrollToBottom]);

  useEffect(() => {
    if (!electronAPI) return;

    const handleAgentMessage = (payload: unknown) => {
      setMessages((current) => [...current, payload as AgentMessage]);
      setIsTyping(false);
      setShowSuggestions(false);
    };

    const handleAgentStatusChanged = (payload: unknown) => {
      const nextPayload = payload as { status?: string };
      setIsTyping(nextPayload.status === 'thinking' || nextPayload.status === 'executing');
    };

    electronAPI.on('agent:message', handleAgentMessage);
    electronAPI.on('agent:statusChanged', handleAgentStatusChanged);

    return () => {
      electronAPI.off('agent:message', handleAgentMessage);
      electronAPI.off('agent:statusChanged', handleAgentStatusChanged);
    };
  }, [electronAPI]);

  const submitMessage = useCallback(
    async (content: string) => {
      const trimmedContent = content.trim();
      if (!trimmedContent) return;

      const userMessage: AgentMessage = {
        id: `user-${Date.now()}`,
        agentId: activeAgent,
        role: 'user',
        content: trimmedContent,
        timestamp: Date.now(),
      };

      setMessages((current) => [...current, userMessage]);
      setInputValue('');
      setShowSuggestions(false);
      setIsTyping(true);

      if (!electronAPI?.agent?.sendMessage) {
        setMessages((current) => [
          ...current,
          createSystemMessage(activeAgent, 'Agent backend is unavailable. Launch the chat from the Electron shell to send messages.'),
        ]);
        setIsTyping(false);
        return;
      }

      try {
        const result = await electronAPI.agent.sendMessage(activeAgent, trimmedContent);
        if (result.error) {
          setMessages((current) => [...current, createSystemMessage(activeAgent, result.error || 'Agent request failed.')]);
          setIsTyping(false);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Agent request failed.';
        setMessages((current) => [...current, createSystemMessage(activeAgent, message)]);
        setIsTyping(false);
      }
    },
    [activeAgent, electronAPI]
  );

  const handleSend = useCallback(async () => {
    await submitMessage(inputValue);
  }, [inputValue, submitMessage]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        void handleSend();
      }
    },
    [handleSend]
  );

  const handleSuggestionClick = useCallback((suggestion: string) => {
    setInputValue(suggestion);
    inputRef.current?.focus();
  }, []);

  const handleQuickAction = useCallback(
    async (prompt: string) => {
      await submitMessage(prompt);
    },
    [submitMessage]
  );

  const formatTime = (timestamp: number): string => {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getAgentInitial = (agentId: AgentRole): string => {
    return AGENT_DISPLAY_NAMES[agentId]?.charAt(0) || 'A';
  };

  const clearConversation = useCallback(() => {
    setMessages([]);
    setInputValue('');
    setShowSuggestions(true);
    setIsTyping(false);
  }, []);

  return (
    <div className="agent-chat">
      <div className="chat-header">
        <div className="chat-header-left">
          <div className="chat-agent-selector">
            <div className="chat-agent-avatar debugger">{getAgentInitial(activeAgent)}</div>
            <div className="chat-agent-info">
              <span className="chat-agent-name">{AGENT_DISPLAY_NAMES[activeAgent]}</span>
              <span className="chat-agent-role">Primary debugger orchestrator</span>
            </div>
          </div>
        </div>

        <div className="chat-header-actions">
          <button className="icon-button tooltip" data-tooltip="Clear chat" onClick={clearConversation}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18" />
              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
            </svg>
          </button>
        </div>
      </div>

      <div className="chat-messages scrollbar-thin">
        {messages.length === 0 && showSuggestions ? (
          <div className="chat-empty-state">
            <svg className="chat-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <h3 className="chat-empty-title">Start a focused debugger conversation</h3>
            <p className="chat-empty-description">
              Ask for stage guidance, evidence review, capture comparison, or root-cause hypotheses.
            </p>
            <div className="chat-empty-suggestions">
              {SUGGESTIONS.map((suggestion) => (
                <button key={suggestion} className="chat-suggestion-chip" onClick={() => handleSuggestionClick(suggestion)}>
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((message, index) => (
              <div
                key={message.id}
                className={`chat-message ${message.role === 'assistant' ? 'assistant' : message.role === 'user' ? 'user' : 'system'}`}
                style={{ animationDelay: `${index * 40}ms` }}
              >
                <div className={`message-avatar ${message.role === 'assistant' ? 'assistant' : message.role === 'user' ? 'user' : 'system'}`}>
                  {message.role === 'user' ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                  ) : message.role === 'system' ? (
                    '!'
                  ) : (
                    getAgentInitial(message.agentId)
                  )}
                </div>

                <div className="message-content-wrapper">
                  <div className="message-header">
                    <span className="message-author">
                      {message.role === 'user'
                        ? 'You'
                        : message.role === 'system'
                          ? 'System'
                          : AGENT_DISPLAY_NAMES[message.agentId]}
                    </span>
                    <span className="message-time">{formatTime(message.timestamp)}</span>
                  </div>

                  <div className={`message-bubble ${message.role === 'assistant' ? 'assistant' : message.role === 'user' ? 'user' : 'system'}`}>
                    {message.content}
                  </div>

                  {message.toolCalls && message.toolCalls.length > 0 && (
                    <div className="message-tools">
                      {message.toolCalls.map((toolCall) => (
                        <div key={toolCall.id} className="tool-call">
                          <svg className="tool-call-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
                          </svg>
                          <span className="tool-call-name">{toolCall.name}</span>
                          <span className={`tool-call-status ${toolCall.result !== undefined ? 'success' : 'running'}`}>
                            {toolCall.result !== undefined ? 'Done' : 'Running'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {isTyping && (
              <div className="typing-indicator">
                <div className="message-avatar assistant">{getAgentInitial(activeAgent)}</div>
                <div className="typing-bubble">
                  <span />
                  <span />
                  <span />
                </div>
                <span className="typing-text">{AGENT_DISPLAY_NAMES[activeAgent]} is reasoning...</span>
              </div>
            )}
          </>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="chat-quick-actions">
        {QUICK_ACTIONS.map((action) => (
          <button key={action.label} className="quick-action" onClick={() => void handleQuickAction(action.prompt)}>
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
            onChange={(event) => setInputValue(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask the debugger to inspect, compare, or summarize the current evidence..."
            rows={1}
          />

          <div className="chat-input-actions">
            <button className="chat-send-button" onClick={() => void handleSend()} disabled={!inputValue.trim() || isTyping}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
        </div>

        <div className="chat-input-hint">
          <span>
            <kbd>Enter</kbd> send
          </span>
          <span>
            <kbd>Shift</kbd> + <kbd>Enter</kbd> newline
          </span>
        </div>
      </div>
    </div>
  );
};

export default AgentChat;

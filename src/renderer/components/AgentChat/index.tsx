import React, { useState, useRef, useEffect, useCallback } from 'react';
import { AGENT_DISPLAY_NAMES } from '@shared/constants/agents';
import type { AgentRole, AgentMessage } from '@shared/types/agent';

interface AgentChatProps {
  initialAgent?: AgentRole;
}

/**
 * AgentChat - Agent对话组件
 * 显示与Agent的对话历史和用户输入
 */
export const AgentChat: React.FC<AgentChatProps> = ({ initialAgent = 'rdc-debugger' }) => {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [activeAgent] = useState<AgentRole>(initialAgent);
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 滚动到底部
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // 监听Agent消息
  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.on('agent:message', (msg: unknown) => {
        const message = msg as AgentMessage;
        setMessages(prev => [...prev, message]);
        setIsTyping(false);
      });

      window.electronAPI.on('agent:statusChanged', (data: unknown) => {
        const { status } = data as { status: string };
        if (status === 'thinking') {
          setIsTyping(true);
        }
      });
    }
  }, []);

  // 发送消息
  const handleSend = useCallback(async () => {
    if (!inputValue.trim()) return;

    const userMessage: AgentMessage = {
      id: `msg-${Date.now()}`,
      agentId: activeAgent,
      role: 'user',
      content: inputValue.trim(),
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsTyping(true);

    if (window.electronAPI) {
      await window.electronAPI.agent.sendMessage(activeAgent, userMessage.content);
    }
  }, [inputValue, activeAgent]);

  // 处理键盘事件
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  return (
    <div className="agent-chat">
      {/* 对话区域 */}
      <div className="chat-messages">
        {messages.length === 0 ? (
          <div className="chat-empty">
            <p>Start a conversation with the agent...</p>
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className={`chat-message ${msg.role}`}>
              <div className="message-header">
                <span className="message-agent">
                  {msg.role === 'user' ? 'You' : AGENT_DISPLAY_NAMES[msg.agentId]}
                </span>
                <span className="message-time">
                  {new Date(msg.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <div className="message-content">
                {msg.content}
              </div>
              {msg.toolCalls && msg.toolCalls.length > 0 && (
                <div className="message-tools">
                  {msg.toolCalls.map((tool, idx) => (
                    <div key={idx} className="tool-call">
                      <span className="tool-name">{tool.name}</span>
                      {tool.result !== undefined && (
                        <span className="tool-result">✓</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}

        {/* 打字指示器 */}
        {isTyping && (
          <div className="chat-message assistant typing">
            <div className="message-header">
              <span className="message-agent">{AGENT_DISPLAY_NAMES[activeAgent]}</span>
            </div>
            <div className="message-content typing-indicator">
              <span></span>
              <span></span>
              <span></span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 输入区域 */}
      <div className="chat-input">
        <textarea
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type your message..."
          rows={3}
        />
        <div className="input-actions">
          <button
            className="button button-primary"
            onClick={handleSend}
            disabled={!inputValue.trim() || isTyping}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
};

export default AgentChat;

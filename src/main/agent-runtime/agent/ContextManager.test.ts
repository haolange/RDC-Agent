/**
 * ContextManager 单元测试。
 */
import { describe, it, expect } from 'vitest';
import { ContextManager } from './ContextManager';
import type { AgentMessage, ToolResultMessage, AssistantMessage, UserMessage } from '../core/types';

function user(text: string): UserMessage {
  return { role: 'user', content: text, timestamp: Date.now() };
}

function assistant(text: string): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    model: 'test-model',
    provider: 'test',
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    stopReason: 'stop',
    timestamp: Date.now(),
  };
}

function toolResult(toolCallId: string, toolName: string, text: string): ToolResultMessage {
  return {
    role: 'toolResult',
    toolCallId,
    toolName,
    content: [{ type: 'text', text }],
    isError: false,
    timestamp: Date.now(),
  };
}

describe('ContextManager', () => {
  describe('convertToLlm', () => {
    it('应保留 user/assistant/toolResult 消息', () => {
      const cm = new ContextManager();
      const msgs: AgentMessage[] = [
        user('hello'),
        assistant('hi'),
        toolResult('tc1', 'bash', 'output'),
      ];
      const result = cm.convertToLlm(msgs);
      expect(result).toHaveLength(3);
      expect(result[0].role).toBe('user');
      expect(result[1].role).toBe('assistant');
      expect(result[2].role).toBe('toolResult');
    });

    it('应过滤掉自定义消息', () => {
      const cm = new ContextManager();
      const custom: AgentMessage = {
        role: 'custom' as AgentMessage['role'],
      } as AgentMessage;
      const msgs: AgentMessage[] = [user('hello'), custom, assistant('ok')];
      const result = cm.convertToLlm(msgs);
      expect(result).toHaveLength(2);
      expect(result[0].role).toBe('user');
      expect(result[1].role).toBe('assistant');
    });
  });

  describe('estimateTokens', () => {
    it('应基于 4 字符 ≈ 1 token 估算', () => {
      const cm = new ContextManager();
      const msgs: AgentMessage[] = [user('hello world!')]; // 12 chars
      const tokens = cm.estimateTokens(msgs);
      expect(tokens).toBe(Math.ceil(12 / 4)); // 3
    });

    it('应累加多条消息的 token', () => {
      const cm = new ContextManager();
      const msgs: AgentMessage[] = [
        user('aaaa'), // 4 chars = 1 token
        assistant('bbbbbbbb'), // 8 chars = 2 tokens
      ];
      const tokens = cm.estimateTokens(msgs);
      expect(tokens).toBe(3);
    });
  });

  describe('compress — 工具结果预算', () => {
    it('工具结果总大小在预算内时不应修改', async () => {
      const cm = new ContextManager({ toolResultBudget: 1000 });
      const msgs: AgentMessage[] = [
        user('hi'),
        toolResult('tc1', 'read', 'short output'),
      ];
      const result = await cm.compress(msgs);
      expect(result).toHaveLength(2);
      expect((result[1] as ToolResultMessage).content[0]).toMatchObject({
        type: 'text',
        text: 'short output',
      });
    });

    it('工具结果超出预算时应截断', async () => {
      const cm = new ContextManager({ toolResultBudget: 100 });
      const longText = 'x'.repeat(5000);
      const msgs: AgentMessage[] = [
        user('hi'),
        toolResult('tc1', 'read', longText),
      ];
      const result = await cm.compress(msgs);
      const tr = result[1] as ToolResultMessage;
      const text = tr.content.map((c) => (c as { text: string }).text).join('');
      expect(text.length).toBeLessThan(longText.length);
      expect(text).toContain('truncated');
    });
  });

  describe('compress — snip', () => {
    it('消息数超出 maxMessages 时应 snip 中间部分', async () => {
      const cm = new ContextManager({ maxMessages: 5 });
      const msgs: AgentMessage[] = [];
      for (let i = 0; i < 20; i++) {
        msgs.push(user(`msg ${i}`));
      }
      const result = await cm.compress(msgs);
      // 保留头 3 + 占位符 + 尾 (5 - 3 - 1 = 1) = 5
      expect(result.length).toBeLessThan(msgs.length);
      const hasSnipPlaceholder = result.some(
        (m) => m.role === 'user' && typeof (m as UserMessage).content === 'string' && String((m as UserMessage).content).includes('snipped'),
      );
      expect(hasSnipPlaceholder).toBe(true);
    });

    it('消息数未超 maxMessages 时不应 snip', async () => {
      const cm = new ContextManager({ maxMessages: 100 });
      const msgs: AgentMessage[] = [];
      for (let i = 0; i < 10; i++) {
        msgs.push(user(`msg ${i}`));
      }
      const result = await cm.compress(msgs);
      expect(result).toHaveLength(msgs.length);
    });
  });

  describe('compress — micro', () => {
    it('早期工具结果应被 compacted', async () => {
      const cm = new ContextManager({
        keepRecentToolResults: 1,
        maxMessages: 100,
        toolResultBudget: 100000,
        contextTokenLimit: 1, // 强制触发 microCompact
      });
      const msgs: AgentMessage[] = [
        user('hello'),
        toolResult('tc1', 'bash', 'output1'),
        assistant('ok'),
        toolResult('tc2', 'bash', 'output2'),
      ];
      const result = await cm.compress(msgs);
      // 第一个工具结果应被 compacted
      const firstTR = result[1] as ToolResultMessage;
      expect(firstTR.content[0]).toMatchObject({
        type: 'text',
        text: '[Earlier tool result compacted]',
      });
      // 最后一个工具结果应保留
      const lastTR = result[3] as ToolResultMessage;
      expect(lastTR.content[0]).toMatchObject({
        type: 'text',
        text: 'output2',
      });
    });
  });

  describe('compress — full', () => {
    it('所有压缩级别都过一遍后应产生摘要', async () => {
      const cm = new ContextManager({
        contextTokenLimit: 1, // 极低限制确保进入 full compact
        toolResultBudget: 10,
        maxMessages: 2,
        keepRecentToolResults: 0,
      });
      const msgs: AgentMessage[] = [];
      for (let i = 0; i < 20; i++) {
        msgs.push(user(`message number ${i} with some content`));
      }
      const result = await cm.compress(msgs);
      // 应包含摘要
      const hasSummary = result.some(
        (m) =>
          m.role === 'user' &&
          typeof (m as UserMessage).content === 'string' &&
          String((m as UserMessage).content).includes('compacted'),
      );
      expect(hasSummary).toBe(true);
    });
  });
});

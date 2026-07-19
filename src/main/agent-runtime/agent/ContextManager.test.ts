/**
 * ContextManager 单元测试。
 */
import { describe, it, expect } from 'vitest';
import { ContextManager, estimateImageTokensFromBase64Length } from './ContextManager';
import { TokenizerService } from '../core/TokenizerService';
import type {
  AgentMessage,
  AssistantMessage,
  ProviderContinuationArtifact,
  ToolResultMessage,
  UserMessage,
} from '../core/types';

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

function createContextManager(
  config: Partial<ConstructorParameters<typeof ContextManager>[0]> = {},
): ContextManager {
  return new ContextManager({ contextTokenLimit: 64_000, ...config });
}

describe('ContextManager', () => {
  it('fails closed when compression has no RequestPlan-derived budget', async () => {
    expect(() => new ContextManager({ contextTokenLimit: 0 }))
      .toThrow('RequestPlan context budget');
  });

  describe('convertToLlm', () => {
    it('应保留 user/assistant/toolResult 消息', () => {
      const cm = createContextManager();
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
      const cm = createContextManager();
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
      const cm = createContextManager();
      const msgs: AgentMessage[] = [user('hello world!')]; // 12 chars
      const tokens = cm.estimateTokens(msgs);
      expect(tokens).toBe(Math.ceil(12 / 4)); // 3
    });

    it('estimates image blocks by decoded bytes instead of base64 character count', () => {
      const base64Length = 4 * 1024 * 1024;
      expect(estimateImageTokensFromBase64Length(base64Length)).toBe(3072);
      const cm = createContextManager();
      expect(cm.estimateTokens([{
        role: 'user',
        content: [{ type: 'image', data: 'a'.repeat(base64Length), mimeType: 'image/png' }],
        timestamp: Date.now(),
      }])).toBe(3072);
    });

    it('应累加多条消息的 token', () => {
      const cm = createContextManager();
      const msgs: AgentMessage[] = [
        user('aaaa'), // 4 chars = 1 token
        assistant('bbbbbbbb'), // 8 chars = 2 tokens
      ];
      const tokens = cm.estimateTokens(msgs);
      expect(tokens).toBe(3);
    });
  });

  describe('estimateTokens — 注入真实 tokenizer', () => {
    const tokenizer = new TokenizerService();

    function tokenizedManager(): ContextManager {
      return createContextManager({ tokenizer, modelId: 'gpt-test' });
    }

    it('注入 tokenizer 后使用真实计数而非字符估算', () => {
      const cm = tokenizedManager();
      const text = 'The quick brown fox jumps over the lazy dog.';
      const expected = tokenizer.countMessagesTokens(
        [{ role: 'user', content: text }],
        'gpt-test',
      );
      expect(cm.estimateTokens([user(text)])).toBe(expected);
      // 真实计数含消息格式开销，与纯字符估算（len/4）不同
      expect(expected).not.toBe(Math.ceil(text.length / 4));
    });

    it('toolCall arguments 计入 token 数', () => {
      const cm = tokenizedManager();
      const base: AssistantMessage = assistant('run');
      const withCall: AssistantMessage = {
        ...base,
        content: [
          ...base.content,
          {
            type: 'toolCall',
            id: 'tc1',
            name: 'grep',
            arguments: { pattern: 'a'.repeat(400), path: '/repo/src' },
          },
        ],
      };
      expect(cm.estimateTokens([withCall])).toBeGreaterThan(cm.estimateTokens([base]) + 50);
    });

    it('thinking continuation payload 按序列化字节计量', () => {
      const cm = tokenizedManager();
      const base: AssistantMessage = assistant('done');
      const withContinuation: AssistantMessage = {
        ...base,
        content: [
          ...base.content,
          {
            type: 'thinking',
            text: '',
            kind: 'opaque',
            source: 'unknown',
            visibility: 'hidden',
            continuation: {
              type: 'test.opaque',
              format: 'opaque',
              signature: 'c'.repeat(4000),
            } as unknown as ProviderContinuationArtifact,
          },
        ],
      };
      expect(cm.estimateTokens([withContinuation]))
        .toBeGreaterThan(cm.estimateTokens([base]) + 900);
    });

    it('图像块经 tokenizer 路径仍按解码字节估算', () => {
      const cm = tokenizedManager();
      const base64Length = 4 * 1024 * 1024;
      const tokens = cm.estimateTokens([{
        role: 'user',
        content: [{ type: 'image', data: 'a'.repeat(base64Length), mimeType: 'image/png' }],
        timestamp: Date.now(),
      }]);
      // 3072 图像 token + 少量消息格式开销
      expect(tokens).toBeGreaterThanOrEqual(3072);
      expect(tokens).toBeLessThan(3072 + 16);
    });
  });

  describe('compress — 工具结果预算', () => {
    it('工具结果总大小在预算内时不应修改', async () => {
      const cm = createContextManager({ toolResultBudget: 1000 });
      const msgs: AgentMessage[] = [
        user('hi'),
        toolResult('tc1', 'read', 'short output'),
      ];
      const result = await cm.compress(msgs);
      expect(result.messages).toHaveLength(2);
      expect((result.messages[1] as ToolResultMessage).content[0]).toMatchObject({
        type: 'text',
        text: 'short output',
      });
    });

    it('工具结果超出预算时应截断', async () => {
      const cm = createContextManager({ toolResultBudget: 100 });
      const longText = 'x'.repeat(5000);
      const msgs: AgentMessage[] = [
        user('hi'),
        toolResult('tc1', 'read', longText),
      ];
      const result = await cm.compress(msgs);
      const tr = result.messages[1] as ToolResultMessage;
      const text = tr.content.map((c) => (c as { text: string }).text).join('');
      expect(text.length).toBeLessThan(longText.length);
      expect(text).toContain('truncated');
      expect(result.summary).toBeUndefined();
    });
  });

  describe('compress — snip', () => {
    it('消息数超出 maxMessages 时应 snip 中间部分', async () => {
      const cm = createContextManager({ maxMessages: 5 });
      const msgs: AgentMessage[] = [];
      for (let i = 0; i < 20; i++) {
        msgs.push(user(`msg ${i}`));
      }
      const result = await cm.compress(msgs);
      // 保留头 3 + 占位符 + 尾 (5 - 3 - 1 = 1) = 5
      expect(result.messages.length).toBeLessThan(msgs.length);
      const handoff = result.messages.find(
        (message) => message.role === 'user' && Boolean((message as UserMessage).derivedContext),
      ) as UserMessage | undefined;
      expect(handoff?.derivedContext).toMatchObject({
        viewId: result.derivedContextView?.viewId,
        sourceHash: result.derivedContextView?.sourceHash,
      });
    });

    it('消息数未超 maxMessages 时不应 snip', async () => {
      const cm = createContextManager({ maxMessages: 100 });
      const msgs: AgentMessage[] = [];
      for (let i = 0; i < 10; i++) {
        msgs.push(user(`msg ${i}`));
      }
      const result = await cm.compress(msgs);
      expect(result.messages).toHaveLength(msgs.length);
      expect(result.summary).toBeUndefined();
    });
  });

  describe('compress — micro', () => {
    it('早期工具结果应被 compacted', async () => {
      const cm = createContextManager({
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
      const firstTR = result.messages[1] as ToolResultMessage;
      expect(firstTR.content[0]).toMatchObject({
        type: 'text',
        text: '[Earlier tool result compacted]',
      });
      // 最后一个工具结果应保留
      const lastTR = result.messages[3] as ToolResultMessage;
      expect(lastTR.content[0]).toMatchObject({
        type: 'text',
        text: 'output2',
      });
    });

    it('压缩后的错误工具结果保留 isError 与错误摘录', async () => {
      const cm = createContextManager({
        keepRecentToolResults: 1,
        maxMessages: 100,
        toolResultBudget: 100000,
        contextTokenLimit: 1,
      });
      const failed: ToolResultMessage = {
        ...toolResult('tc1', 'bash', 'Command failed: exit code 2 — permission denied'),
        isError: true,
      };
      const msgs: AgentMessage[] = [
        user('hello'),
        failed,
        assistant('ok'),
        toolResult('tc2', 'bash', 'output2'),
      ];
      const result = await cm.compress(msgs);
      const firstTR = result.messages[1] as ToolResultMessage;
      expect(firstTR.isError).toBe(true);
      const text = (firstTR.content[0] as { text: string }).text;
      expect(text).toContain('[Earlier tool error compacted:');
      expect(text).toContain('permission denied');
    });
  });

  describe('compress — full', () => {
    it('所有压缩级别都过一遍后应产生摘要', async () => {
      const cm = createContextManager({
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
      const handoff = result.messages.find(
        (message) => message.role === 'user' && Boolean((message as UserMessage).derivedContext),
      ) as UserMessage | undefined;
      expect(handoff?.derivedContext?.handoffId).toBe(result.derivedContextView?.handoff.handoffId);
    });
  });
});

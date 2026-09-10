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
  return new ContextManager({
    contextTokenLimit: 64_000,
    ...config,
  });
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
        toolResult('tc1', 'shell', 'output'),
      ];
      const result = cm.convertToLlm(msgs);
      expect(result).toHaveLength(3);
      expect(result[0].role).toBe('user');
      expect(result[1].role).toBe('assistant');
      expect(result[2].role).toBe('toolResult');
    });

    it('bridges tool-result images into a following user message', () => {
      const cm = createContextManager();
      const withImage: ToolResultMessage = {
        role: 'toolResult',
        toolCallId: 'img-1',
        toolName: 'read_image',
        content: [
          { type: 'text', text: 'Viewed image frame.png' },
          { type: 'image', data: 'aaa', mimeType: 'image/png' },
        ],
        isError: false,
        timestamp: Date.now(),
      };
      const result = cm.convertToLlm([user('look'), withImage]);
      expect(result).toHaveLength(3);
      expect(result[1]).toMatchObject({
        role: 'toolResult',
        toolName: 'read_image',
      });
      expect(result[1].role === 'toolResult' && result[1].content.every((block) => block.type !== 'image')).toBe(true);
      expect(result[2]).toMatchObject({ role: 'user' });
      expect(result[2].role === 'user' && Array.isArray(result[2].content)).toBe(true);
      if (result[2].role !== 'user' || !Array.isArray(result[2].content)) throw new Error('expected user image bridge');
      expect(result[2].content.some((block) => block.type === 'image')).toBe(true);
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

  describe('recoverable model windows', () => {
    it('preserves entire tool results including middle qualifications below the request limit', async () => {
      const text = 'x'.repeat(5000) + ' hypothesis only; not a verified cause';
      const messages = [user('inspect'), toolResult('call', 'read', text)];
      expect((await createContextManager().compress(messages)).messages).toEqual(messages);
    });
    it('does not snip a long sequence of short messages', async () => {
      const messages = Array.from({ length: 100 }, (_, i) => user(`revision ${i}`));
      expect((await createContextManager().compress(messages)).messages).toEqual(messages);
    });
    it('fails without a recoverable service instead of deleting old messages', async () => {
      const messages = [user('x'.repeat(5000)), assistant('later')];
      const original = structuredClone(messages);
      await expect(createContextManager({ contextTokenLimit: 20 }).compress(messages)).rejects.toThrow('CONTEXT_CANNOT_FIT');
      expect(messages).toEqual(original);
    });
    it('never strips user images to fit', async () => {
      const messages = [user('look')];
      messages[0].content = [{ type: 'image', data: 'x'.repeat(4096), mimeType: 'image/png' }];
      await expect(createContextManager({ contextTokenLimit: 20 }).compress(messages)).rejects.toThrow('CONTEXT_CANNOT_FIT');
      expect(messages[0].content).toEqual([{ type: 'image', data: 'x'.repeat(4096), mimeType: 'image/png' }]);
    });
    it('preserves full negative evidence and original error flags', async () => {
      const failed = { ...toolResult('call', 'shell', 'x'.repeat(5000) + ' rollback not confirmed'), isError: true };
      expect((await createContextManager().compress([failed])).messages).toEqual([failed]);
    });
    it('uses a verified candidate supplied by the maintenance service', async () => {
      const compact = async () => ({ messages: [user('qualified checkpoint')], summary: 'saved' });
      expect(await createContextManager({ contextTokenLimit: 20, compact }).compress([user('x'.repeat(5000))])).toEqual({ messages: [expect.objectContaining({ content: 'qualified checkpoint' })], summary: 'saved' });
    });
    it('rejects an oversized candidate without a second lossy fallback', async () => {
      const messages = [user('x'.repeat(5000))];
      await expect(createContextManager({ contextTokenLimit: 20, compact: async () => ({ messages }) }).compress(messages)).rejects.toThrow('CONTEXT_CANNOT_FIT');
    });
    it('propagates storage failures and retains canonical content', async () => {
      const messages = [user('original revision')];
      await expect(createContextManager({ compact: async () => { throw new Error('disk full'); } }).compress(messages)).rejects.toThrow('disk full');
      expect(messages[0].content).toBe('original revision');
    });
    it('rejects a cancelled maintenance result', async () => {
      const controller = new AbortController();
      const cm = createContextManager({ compact: async messages => { controller.abort(); return { messages }; } });
      await expect(cm.compress([user('hello')], controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    });
  });
});

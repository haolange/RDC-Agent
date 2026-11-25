import { describe, expect, it, vi } from 'vitest';

const encodeCalls = vi.hoisted(() => ({ count: 0 }));
vi.mock('gpt-tokenizer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('gpt-tokenizer')>();
  return {
    ...actual,
    encode: (...args: Parameters<typeof actual.encode>) => {
      encodeCalls.count += 1;
      return actual.encode(...args);
    },
  };
});

const { TokenizerService } = await import('./TokenizerService');

describe('TokenizerService', () => {
  it('encodes a long history text once and answers later steps from the cache', () => {
    const tokenizer = new TokenizerService();
    const history = [{ role: 'user', content: 'The capture shows an overdraw spike in the shadow pass. '.repeat(40) }];
    encodeCalls.count = 0;
    const first = tokenizer.countMessagesTokens(history, 'model');
    const second = tokenizer.countMessagesTokens([{ ...history[0] }], 'model');
    expect(second).toBe(first);
    expect(encodeCalls.count).toBe(1);
  });

  it('estimates by characters without a model and for text the encoder rejects', () => {
    const tokenizer = new TokenizerService();
    expect(tokenizer.countTokens('abcdefgh')).toBe(2);
    expect(tokenizer.countTokens('<|endoftext|>'.repeat(30), 'model')).toBe(Math.ceil(390 / 4));
  });
});

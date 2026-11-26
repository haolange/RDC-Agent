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

  it('rescales later estimates of one scope and model by the prompt tokens its provider reported', () => {
    const tokenizer = new TokenizerService();
    const calibration = tokenizer.calibration('session-a', 'model-x');
    expect(calibration.toProviderTokens(1_000)).toBe(1_000);

    calibration.observe(1_000, 1_300);
    expect(calibration.toProviderTokens(2_000)).toBe(2_600);
    expect(calibration.toEstimateTokens(13_000)).toBe(10_000);
    // A later report moves the ratio halfway; a report without input tokens leaves it alone.
    calibration.observe(1_000, 1_100);
    calibration.observe(1_000, 0);
    expect(calibration.ratio).toBeCloseTo(1.2);
    // An outlier is clamped to the bound instead of swinging estimates without limit.
    calibration.observe(100, 10_000);
    expect(calibration.ratio).toBeCloseTo(1.6);

    expect(tokenizer.calibration('session-a', 'model-x')).toBe(calibration);
    expect(tokenizer.calibration('session-a', 'model-y').ratio).toBe(1);
    expect(tokenizer.calibration('session-b', 'model-x').ratio).toBe(1);
  });
});

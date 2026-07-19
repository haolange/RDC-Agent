import { describe, expect, it } from 'vitest';
import type { Context } from '../core/types';
import { partitionSystemPrompt } from './promptCacheWire';

const context = (overrides: Partial<Context> = {}): Context => ({
  systemPrompt: 'Stable A\n\nStable B\n\nVolatile',
  systemPromptSegments: [
    {
      id: 'stable-a',
      kind: 'core-contract',
      scope: 'builtin',
      sourcePath: 'builtin://a',
      sourceHash: 'a',
      precedence: 0,
      content: 'Stable A',
      stability: 'stable',
      tokenEstimate: 2,
    },
    {
      id: 'stable-b',
      kind: 'agent-profile',
      scope: 'user',
      sourcePath: 'user://b',
      sourceHash: 'b',
      precedence: 1,
      content: 'Stable B',
      stability: 'stable',
      tokenEstimate: 2,
    },
    {
      id: 'volatile',
      kind: 'runtime-fact',
      scope: 'runtime',
      sourcePath: 'runtime://facts',
      sourceHash: 'c',
      precedence: 2,
      content: 'Volatile',
      stability: 'volatile',
      tokenEstimate: 2,
    },
  ],
  messages: [],
  ...overrides,
});

describe('partitionSystemPrompt', () => {
  it('materializes one exact stable prefix and a volatile suffix', () => {
    const partition = partitionSystemPrompt(context());
    expect(partition).toEqual({
      combinedText: 'Stable A\n\nStable B\n\nVolatile',
      stableText: 'Stable A\n\nStable B\n\n',
      volatileText: 'Volatile',
    });
    expect(partition.stableText! + partition.volatileText!).toBe(partition.combinedText);
  });

  it('fails closed when runtime text and PromptPlan ownership diverge', () => {
    expect(() => partitionSystemPrompt(context({ systemPrompt: 'mutated' })))
      .toThrow('PROMPT_PLAN_CONTEXT_MISMATCH');
  });

  it('fails closed when a stable segment appears after volatile content', () => {
    const invalid = context();
    invalid.systemPromptSegments = [
      invalid.systemPromptSegments![0],
      { ...invalid.systemPromptSegments![2], content: 'Volatile' },
      { ...invalid.systemPromptSegments![1], content: 'Stable B' },
    ];
    invalid.systemPrompt = 'Stable A\n\nVolatile\n\nStable B';
    expect(() => partitionSystemPrompt(invalid))
      .toThrow('PROMPT_PLAN_STABILITY_ORDER_INVALID');
  });
});

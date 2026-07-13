import { describe, expect, it } from 'vitest';
import type { ReasoningControl } from '@shared/types/modelCapability';
import { applyAnthropicReasoning, buildOpenAiResponsesReasoning } from './reasoningWire';

const openAi56 = {
  kind: 'levels',
  supportsOff: true,
  levels: ['low', 'medium', 'high', 'extra', 'max'],
  defaultSelection: 'medium',
  wireProfile: {
    kind: 'openai-responses',
    on: 'medium',
    levels: { low: 'low', medium: 'medium', high: 'high', extra: 'xhigh', max: 'max' },
  },
} satisfies ReasoningControl;
const kimiToggle = { kind: 'toggle', supportsOff: true, levels: [], defaultSelection: 'on', wireProfile: { kind: 'anthropic', on: 'high', onMode: 'enabled', onBudgetTokens: 4096, offMode: 'disabled' } } satisfies ReasoningControl;
const glmToggle = { kind: 'toggle', supportsOff: true, levels: [], defaultSelection: 'on', wireProfile: { kind: 'anthropic', on: 'high', onMode: 'enabled', offMode: 'disabled' } } satisfies ReasoningControl;
const deepSeekLevels = { kind: 'levels', supportsOff: true, levels: ['high', 'max'], defaultSelection: 'high', wireProfile: { kind: 'anthropic', on: 'high', levels: { high: 'high', max: 'max' }, onMode: 'enabled', offMode: 'disabled' } } satisfies ReasoningControl;

describe('buildOpenAiResponsesReasoning', () => {
  it('maps GPT-5.6 product extra/max to wire xhigh/max', () => {
    const reasoningControl = openAi56;

    expect(buildOpenAiResponsesReasoning({
      selection: 'extra',
      control: reasoningControl,
    }).reasoning).toMatchObject({ effort: 'xhigh' });

    expect(buildOpenAiResponsesReasoning({
      selection: 'max',
      control: reasoningControl,
    }).reasoning).toMatchObject({ effort: 'max' });
  });
});

describe('applyAnthropicReasoning', () => {
  it('restores Kimi Coding Plan toggle On to the budgeted anthropic payload', () => {
    const reasoningControl = kimiToggle;

    const body: Record<string, unknown> = {};
    applyAnthropicReasoning(body, {
      selection: 'on',
      control: reasoningControl,
    }, 'summary-events');

    expect(body.thinking).toMatchObject({
      type: 'enabled',
      budget_tokens: 4096,
      display: 'summarized',
    });
  });

  it('keeps generic anthropic toggle models unbudgeted unless the catalog asks for it', () => {
    const reasoningControl = glmToggle;

    const body: Record<string, unknown> = {};
    applyAnthropicReasoning(body, {
      selection: 'on',
      control: reasoningControl,
    });

    expect(body.thinking).toMatchObject({ type: 'enabled' });
    expect((body.thinking as { budget_tokens?: number }).budget_tokens).toBeUndefined();
  });

  it('still disables Kimi Coding Plan thinking when Off is selected', () => {
    const reasoningControl = kimiToggle;

    const body: Record<string, unknown> = {};
    applyAnthropicReasoning(body, {
      selection: 'off',
      control: reasoningControl,
    });

    expect(body.thinking).toEqual({ type: 'disabled' });
  });

  it('maps DeepSeek v4 flash product max to enabled thinking plus effort max', () => {
    const reasoningControl = deepSeekLevels;
    expect(reasoningControl).toMatchObject({
      kind: 'levels',
      levels: ['high', 'max'],
    });

    const body: Record<string, unknown> = {};
    applyAnthropicReasoning(body, {
      selection: 'max',
      control: reasoningControl,
    });

    expect(body.thinking).toMatchObject({ type: 'enabled' });
    expect(body.output_config).toEqual({ effort: 'max' });
  });
});

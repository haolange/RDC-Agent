import { describe, expect, it } from 'vitest';
import type { ReasoningControl } from '@shared/types/modelCapability';
import {
  applyAnthropicReasoning,
  applyGeminiReasoning,
  applyMoonshotReasoning,
  applyOpenAiCompatibleReasoning,
  buildOpenAiResponsesReasoning,
} from './reasoningWire';

const openAi56 = {
  kind: 'levels',
  supportsOff: true,
  levels: ['low', 'medium', 'high', 'xhigh', 'max'],
  defaultSelection: 'medium',
  wireProfile: {
    kind: 'openai-responses',
    on: 'medium',
    levels: { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' },
  },
} satisfies ReasoningControl;
const kimiToggle = { kind: 'toggle', supportsOff: true, levels: [], defaultSelection: 'on', wireProfile: { kind: 'anthropic', on: 'high', onMode: 'enabled', onBudgetTokens: 4096, offMode: 'disabled' } } satisfies ReasoningControl;
const glmToggle = { kind: 'toggle', supportsOff: true, levels: [], defaultSelection: 'on', wireProfile: { kind: 'anthropic', on: 'high', onMode: 'enabled', offMode: 'disabled' } } satisfies ReasoningControl;
const deepSeekLevels = { kind: 'levels', supportsOff: true, levels: ['high', 'max'], defaultSelection: 'high', wireProfile: { kind: 'anthropic', on: 'high', levels: { high: 'high', max: 'max' }, onMode: 'enabled', offMode: 'disabled' } } satisfies ReasoningControl;

describe('buildOpenAiResponsesReasoning', () => {
  it('maps GPT-5.6 xhigh/max to the same canonical wire values', () => {
    const reasoningControl = openAi56;

    expect(buildOpenAiResponsesReasoning({
      selection: 'xhigh',
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

describe('remaining reasoning wire profiles', () => {
  it('compiles OpenAI-compatible on/off activations and effort', () => {
    const control = {
      kind: 'levels', supportsOff: true, levels: ['high'], defaultSelection: 'high',
      wireProfile: {
        kind: 'openai-compatible', on: 'high', levels: { high: 'high' },
        onMode: 'enable-thinking-true', offMode: 'enable-thinking-false',
      },
    } satisfies ReasoningControl;
    const enabled: Record<string, unknown> = {};
    applyOpenAiCompatibleReasoning(enabled, { selection: 'high', control });
    expect(enabled).toEqual({ enable_thinking: true, reasoning_effort: 'high' });
    const disabled: Record<string, unknown> = {};
    applyOpenAiCompatibleReasoning(disabled, { selection: 'off', control });
    expect(disabled).toEqual({ enable_thinking: false });
  });

  it('compiles Gemini thinking-level and thinking-budget profiles', () => {
    const levelControl = {
      kind: 'levels', supportsOff: false, levels: ['high'], defaultSelection: 'high',
      wireProfile: { kind: 'gemini-thinking-level', on: 'high', levels: { high: 'high' } },
    } satisfies ReasoningControl;
    const levelConfig: Record<string, unknown> = {};
    applyGeminiReasoning(levelConfig, { selection: 'high', control: levelControl });
    expect(levelConfig).toEqual({ thinkingConfig: { thinkingLevel: 'high' } });

    const budgetControl = {
      kind: 'levels', supportsOff: true, levels: ['medium'], defaultSelection: 'medium',
      wireProfile: { kind: 'gemini-thinking-budget', on: 'medium', levels: { medium: 8192 }, offBudget: 0 },
    } satisfies ReasoningControl;
    const enabledBudget: Record<string, unknown> = {};
    applyGeminiReasoning(enabledBudget, { selection: 'medium', control: budgetControl });
    expect(enabledBudget).toEqual({ thinkingConfig: { thinkingBudget: 8192 } });
    const disabledBudget: Record<string, unknown> = {};
    applyGeminiReasoning(disabledBudget, { selection: 'off', control: budgetControl });
    expect(disabledBudget).toEqual({ thinkingConfig: { thinkingBudget: 0 } });
  });

  it('compiles Moonshot thinking on and off explicitly', () => {
    const control = {
      kind: 'toggle', supportsOff: true, levels: [], defaultSelection: 'on',
      wireProfile: { kind: 'moonshot-thinking', onMode: 'enabled', offMode: 'disabled' },
    } satisfies ReasoningControl;
    const enabled: Record<string, unknown> = {};
    applyMoonshotReasoning(enabled, { selection: 'on', control });
    expect(enabled).toEqual({ thinking: { type: 'enabled' } });
    const disabled: Record<string, unknown> = {};
    applyMoonshotReasoning(disabled, { selection: 'off', control });
    expect(disabled).toEqual({ thinking: { type: 'disabled' } });
  });
});

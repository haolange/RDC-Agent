import { describe, expect, it } from 'vitest';
import { lookupManagedModelCapabilityProfile } from '@shared/constants/modelCapabilityCatalog';
import { applyAnthropicReasoning, buildOpenAiResponsesReasoning } from './reasoningWire';

describe('buildOpenAiResponsesReasoning', () => {
  it('maps GPT-5.6 product extra/max to wire xhigh/max', () => {
    const reasoningControl = lookupManagedModelCapabilityProfile('openai', 'gpt-5.6-sol')?.reasoningControl;
    expect(reasoningControl).toBeTruthy();

    expect(buildOpenAiResponsesReasoning({
      selection: 'extra',
      control: reasoningControl!,
    }).reasoning).toMatchObject({ effort: 'xhigh' });

    expect(buildOpenAiResponsesReasoning({
      selection: 'max',
      control: reasoningControl!,
    }).reasoning).toMatchObject({ effort: 'max' });
  });
});

describe('applyAnthropicReasoning', () => {
  it('restores Kimi Coding Plan toggle On to the budgeted anthropic payload', () => {
    const reasoningControl = lookupManagedModelCapabilityProfile('kimi-coding-plan', 'kimi-for-coding')?.reasoningControl;
    expect(reasoningControl).toBeTruthy();

    const body: Record<string, unknown> = {};
    applyAnthropicReasoning(body, {
      selection: 'on',
      control: reasoningControl!,
    }, 'summary-events');

    expect(body.thinking).toMatchObject({
      type: 'enabled',
      budget_tokens: 4096,
      display: 'summarized',
    });
  });

  it('keeps generic anthropic toggle models unbudgeted unless the catalog asks for it', () => {
    const reasoningControl = lookupManagedModelCapabilityProfile('glm-cn', 'glm-5')?.reasoningControl;
    expect(reasoningControl).toBeTruthy();

    const body: Record<string, unknown> = {};
    applyAnthropicReasoning(body, {
      selection: 'on',
      control: reasoningControl!,
    });

    expect(body.thinking).toMatchObject({ type: 'enabled' });
    expect((body.thinking as { budget_tokens?: number }).budget_tokens).toBeUndefined();
  });

  it('still disables Kimi Coding Plan thinking when Off is selected', () => {
    const reasoningControl = lookupManagedModelCapabilityProfile('kimi-coding-plan', 'kimi-for-coding')?.reasoningControl;
    expect(reasoningControl).toBeTruthy();

    const body: Record<string, unknown> = {};
    applyAnthropicReasoning(body, {
      selection: 'off',
      control: reasoningControl!,
    });

    expect(body.thinking).toEqual({ type: 'disabled' });
  });

  it('maps DeepSeek v4 flash product max to enabled thinking plus effort max', () => {
    const reasoningControl = lookupManagedModelCapabilityProfile('deepseek', 'deepseek-v4-flash')?.reasoningControl;
    expect(reasoningControl).toBeTruthy();
    expect(reasoningControl).toMatchObject({
      kind: 'levels',
      levels: ['high', 'max'],
    });

    const body: Record<string, unknown> = {};
    applyAnthropicReasoning(body, {
      selection: 'max',
      control: reasoningControl!,
    });

    expect(body.thinking).toMatchObject({ type: 'enabled' });
    expect(body.output_config).toEqual({ effort: 'max' });
  });
});

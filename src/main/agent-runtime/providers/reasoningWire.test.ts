import { describe, expect, it } from 'vitest';
import { lookupManagedModelCapabilityProfile } from '@shared/constants/modelCapabilityCatalog';
import { applyAnthropicReasoning } from './reasoningWire';

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
});

import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { parseCopilotBillingTiers, parseCopilotModelCatalog } from './CopilotBilling';

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'copilot-models.json'), 'utf8')) as unknown;

describe('Copilot billing catalog', () => {
  it('parses account-specific default and long-context prompt caps', () => {
    const catalog = parseCopilotModelCatalog(fixture);
    expect(catalog.models.map((model) => model.id)).toEqual(['gpt-5.5', 'gpt-5-mini', 'claude-opus-4.8']);
    expect(catalog.contributions[0]).toMatchObject({
      modelId: 'gpt-5.5',
      defaultBudgetTokens: 272_000,
      contextTiers: [{ maxPromptTokens: 272_000, maxOutputTokens: 128_000, maxTotalTokens: 400_000 }],
      reasoning: {
        kind: 'levels',
        supportsOff: true,
        levels: ['low', 'medium', 'high', 'xhigh'],
        defaultSelection: 'high',
        wireProfile: expect.objectContaining({ kind: 'openai-compatible', offMode: 'reasoning-none' }),
      },
      toolCalling: { state: 'supported' },
      visionInput: { state: 'supported' },
      structuredOutput: { state: 'supported' },
      fast: { kind: 'unsupported' },
    });
    expect(catalog.contributions.find((model) => model.modelId === 'claude-opus-4.8')?.fast).toEqual({
      kind: 'model-variant',
      modelId: 'claude-opus-4.8-fast',
      entitlement: 'granted',
    });
    expect(catalog.contributions.some((model) => model.modelId === 'claude-opus-4.8-fast')).toBe(false);
    expect(parseCopilotBillingTiers(catalog.billingByModel['gpt-5.5'])).toEqual([
      { id: 'default', label: 'Default', maxPromptTokens: 272_000, maxOutputTokens: 128_000, maxTotalTokens: 400_000, activation: { kind: 'implicit' }, entitlement: 'granted' },
      { id: 'long_context', label: 'Long context', maxPromptTokens: 922_000, maxOutputTokens: 128_000, maxTotalTokens: 1_050_000, activation: { kind: 'implicit' }, entitlement: 'unknown' },
    ]);
  });

  it('keeps a conservative single tier when no long-context billing row exists', () => {
    const catalog = parseCopilotModelCatalog(fixture);
    expect(parseCopilotBillingTiers(catalog.billingByModel['gpt-5-mini'])).toEqual([
      { id: 'default', label: 'Default', maxPromptTokens: 272_000, maxOutputTokens: 64_000, maxTotalTokens: 336_000, activation: { kind: 'implicit' }, entitlement: 'unknown' },
    ]);
  });
});

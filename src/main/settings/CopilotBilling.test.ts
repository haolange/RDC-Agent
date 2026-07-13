import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { parseCopilotBillingTiers, parseCopilotModelCatalog } from './CopilotBilling';

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'copilot-models.json'), 'utf8')) as unknown;

describe('Copilot billing catalog', () => {
  it('parses account-specific default and long-context prompt caps', () => {
    const catalog = parseCopilotModelCatalog(fixture);
    expect(catalog.models.map((model) => model.id)).toEqual(['gpt-5.5', 'gpt-5-mini']);
    expect(parseCopilotBillingTiers(catalog.billingByModel['gpt-5.5'])).toEqual([
      { id: 'default', label: 'Default', maxPromptTokens: 272_000, activation: { kind: 'implicit' }, entitlement: 'granted' },
      { id: 'long_context', label: 'Long context', maxPromptTokens: 922_000, activation: { kind: 'implicit' }, entitlement: 'unknown' },
    ]);
  });

  it('keeps a conservative single tier when no long-context billing row exists', () => {
    const catalog = parseCopilotModelCatalog(fixture);
    expect(parseCopilotBillingTiers(catalog.billingByModel['gpt-5-mini'])).toEqual([
      { id: 'default', label: 'Default', maxPromptTokens: 272_000, activation: { kind: 'implicit' }, entitlement: 'unknown' },
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import type { AgentModelOption } from '@shared/types/agentManifest';
import {
  agentModelOptionAccessibleLabel,
  isAgentModelSelectionInvalid,
} from './AgentModelCascadeSelect';

const primaryOption: AgentModelOption = {
  canonicalId: 'kimi-coding-plan/kimi-for-coding',
  providerId: 'kimi-coding-plan',
  providerLabel: 'Kimi Coding Plan',
  modelId: 'kimi-for-coding',
  modelLabel: 'Kimi for Coding',
  configured: true,
  status: 'ready',
};

describe('AgentModelCascadeSelect selection validation', () => {
  it('accepts a projected primary option', () => {
    expect(isAgentModelSelectionInvalid(primaryOption.canonicalId, [primaryOption])).toBe(false);
  });

  it('fails closed when a persisted internal target is absent from projection', () => {
    expect(isAgentModelSelectionInvalid(
      'kimi-coding-plan/kimi-for-coding-highspeed',
      [primaryOption],
    )).toBe(true);
  });

  it('allows an empty route while the user is choosing a model', () => {
    expect(isAgentModelSelectionInvalid('', [primaryOption])).toBe(false);
  });

  it('keeps the canonical route in accessibility metadata instead of a second visual line', () => {
    expect(agentModelOptionAccessibleLabel(primaryOption, 'Unavailable')).toBe(
      'Kimi for Coding · kimi-coding-plan/kimi-for-coding',
    );
    expect(agentModelOptionAccessibleLabel({
      ...primaryOption,
      configured: false,
      disabledReason: 'Account entitlement denied',
    }, 'Unavailable')).toBe(
      'Kimi for Coding · kimi-coding-plan/kimi-for-coding · Account entitlement denied',
    );
  });
});

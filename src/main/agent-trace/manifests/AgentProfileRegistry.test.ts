import { describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_ID } from '@shared/types/agent';
import { agentProfileRegistry } from './AgentProfileRegistry';
import { createTraceAgentProfile } from './profileManifest';

describe('AgentProfileRegistry', () => {
  it('uses the builtin general manifest when profileId is missing', () => {
    const profile = agentProfileRegistry.get('');
    expect(profile.agentType).toBe(DEFAULT_AGENT_ID);
    expect(profile.displayName).toBe('General');
    expect(profile.agentType).not.toBe('ask');
    expect(profile.agentType).not.toBe('debugger');
  });

  it('keeps a custom ask profile instead of rewriting it to debugger', () => {
    const profile = agentProfileRegistry.get('ask');
    expect(profile.agentType).toBe('ask');
    expect(profile.displayName).toBe('ask');
    expect(profile.description).toMatch(/Custom agent profile ask/);
    expect(profile.agentType).not.toBe('debugger');
    expect(profile.displayName).not.toBe('Debugger');
  });

  it('generates a neutral profile for an arbitrary custom id', () => {
    const profile = agentProfileRegistry.get('review-bot');
    expect(profile.agentType).toBe('review-bot');
    expect(profile.displayName).toBe('review-bot');
    expect(profile.description).toMatch(/Custom agent profile review-bot/);
  });

  it('does not use debugger as a silent identity fallback', () => {
    expect(createTraceAgentProfile('ask').agentType).toBe('ask');
    expect(createTraceAgentProfile('').agentType).toBe(DEFAULT_AGENT_ID);
    expect(agentProfileRegistry.getForMode('ask').agentType).toBe('ask');
  });
});

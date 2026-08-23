import { describe, expect, it } from 'vitest';
import {
  classifyAgentToolEligibility,
  describeAgentToolIneligibility,
  hasImplementedStructuredToolAdapter,
  isAgentToolExecutableModel,
  toolCallingEvidenceOf,
} from './agentToolCapability';

const executable = {
  enabled: true,
  availability: 'available' as const,
  selection: { pickerVisibility: 'primary' as const },
  toolCalling: { state: 'supported' as const },
  route: { protocol: 'OpenAICompatibleChatCompletions' },
};

describe('agentToolCapability', () => {
  it('treats every registered adapter protocol as a structured-tool carrier', () => {
    expect(hasImplementedStructuredToolAdapter('OpenAICompatibleChatCompletions')).toBe(true);
    expect(hasImplementedStructuredToolAdapter('GoogleVertexAnthropic')).toBe(true);
    expect(hasImplementedStructuredToolAdapter('AzureOpenAIChatCompletions')).toBe(true);
    expect(hasImplementedStructuredToolAdapter('not-a-protocol')).toBe(false);
    expect(hasImplementedStructuredToolAdapter(undefined)).toBe(false);
  });

  it('admits only source-backed supported models with an implemented adapter', () => {
    expect(isAgentToolExecutableModel(executable)).toBe(true);
    expect(classifyAgentToolEligibility({
      ...executable,
      toolCalling: { state: 'unknown' },
    })).toBe('unknown');
    expect(isAgentToolExecutableModel({
      ...executable,
      toolCalling: { state: 'unknown' },
    })).toBe(false);
    expect(classifyAgentToolEligibility({
      ...executable,
      toolCalling: { state: 'unsupported' },
    })).toBe('unsupported');
    expect(isAgentToolExecutableModel({
      ...executable,
      availability: 'unavailable',
    })).toBe(false);
    expect(classifyAgentToolEligibility({
      ...executable,
      selection: { pickerVisibility: 'internal' },
    })).toBe('internal');
  });

  it('does not treat picker-visible unknown or unsupported models as Agent-executable', () => {
    expect(toolCallingEvidenceOf('unknown')).toBe('unknown');
    expect(toolCallingEvidenceOf(undefined)).toBe('unknown');
    expect(isAgentToolExecutableModel({
      enabled: true,
      availability: 'unknown',
      selection: { pickerVisibility: 'primary' },
      toolCalling: { state: 'supported' },
      route: { protocol: 'AnthropicMessages' },
    })).toBe(false);
    expect(isAgentToolExecutableModel({
      enabled: true,
      availability: 'unknown',
      selection: { pickerVisibility: 'primary' },
      toolCalling: { state: 'unknown' },
      route: { protocol: 'AnthropicMessages' },
    })).toBe(false);
  });

  it('keeps unknown and unsupported user-facing diagnostics distinct', () => {
    expect(describeAgentToolIneligibility('unknown', 'cline-pass', 'kimi').userMessage)
      .toContain('尚未证实');
    expect(describeAgentToolIneligibility('unknown', 'cline-pass', 'kimi').userMessage)
      .not.toContain('明确不支持');
    expect(describeAgentToolIneligibility('unsupported', 'cline-pass', 'kimi').userMessage)
      .toContain('明确不支持');
  });
});

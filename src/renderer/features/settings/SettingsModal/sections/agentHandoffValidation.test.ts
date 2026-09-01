import { describe, expect, it } from 'vitest';
import type { AgentHandoffDefinition, AgentManifestDefinition, AgentModelOption } from '@shared/types/agentManifest';
import { findProjectedHandoffTargetConflicts, persistAgentHandoff, validateAgentHandoffs } from './agentHandoffValidation';

const definition = (id: string, enabled: boolean): AgentManifestDefinition => ({
  id,
  fileName: `${id}.agent.md`,
  filePath: `${id}.agent.md`,
  name: id,
  description: '',
  argumentHint: '',
  target: 'rdc-agent',
  models: [],
  icon: 'spark',
  accent: '#33d1ff',
  disableModelInvocation: false,
  userInvocable: true,
  tools: [],
  skills: [],
  mcpServers: [],
  agents: [],
  handoffs: [],
  metadata: {},
  instructions: '',
  builtin: false,
  enabled,
});

const modelOption = (canonicalId: string): AgentModelOption => ({
  canonicalId,
  providerId: 'openai',
  providerLabel: 'OpenAI',
  modelId: canonicalId.split(':')[1] ?? canonicalId,
  modelLabel: canonicalId,
  configured: true,
  status: 'ready',
});

const ctx = {
  selfId: 'general',
  definitions: [definition('general', true), definition('debugger', true), definition('analyzer', false)],
  modelOptions: [modelOption('openai:gpt-4.1')],
};

const valid: AgentHandoffDefinition = {
  label: 'Debug',
  agent: 'debugger',
  prompt: 'Investigate the capture.',
};

describe('validateAgentHandoffs', () => {
  it('accepts an empty handoff list as a legal configuration', () => {
    expect(validateAgentHandoffs([], ctx)).toEqual([]);
  });

  it('reports label-required for a blank label', () => {
    expect(validateAgentHandoffs([{ ...valid, label: '  ' }], ctx)).toEqual([
      { index: 0, field: 'label', code: 'label-required' },
    ]);
  });

  it('reports target-required when the agent is empty', () => {
    expect(validateAgentHandoffs([{ ...valid, agent: '' }], ctx)).toEqual([
      { index: 0, field: 'agent', code: 'target-required' },
    ]);
  });

  it('reports target-unknown when the agent is missing from definitions', () => {
    expect(validateAgentHandoffs([{ ...valid, agent: 'missing' }], ctx)).toEqual([
      { index: 0, field: 'agent', code: 'target-unknown' },
    ]);
  });

  it('reports target-disabled and keeps the original id', () => {
    const handoff = { ...valid, agent: 'analyzer' };
    expect(validateAgentHandoffs([handoff], ctx)).toEqual([
      { index: 0, field: 'agent', code: 'target-disabled' },
    ]);
    expect(handoff.agent).toBe('analyzer');
    expect(persistAgentHandoff(handoff).agent).toBe('analyzer');
  });

  it('reports target-self when the target is the current agent', () => {
    expect(validateAgentHandoffs([{ ...valid, agent: 'general' }], ctx)).toEqual([
      { index: 0, field: 'agent', code: 'target-self' },
    ]);
  });

  it('reports prompt-required for a blank prompt', () => {
    expect(validateAgentHandoffs([{ ...valid, prompt: '' }], ctx)).toEqual([
      { index: 0, field: 'prompt', code: 'prompt-required' },
    ]);
  });

  it('reports model-invalid for a selection absent from projection', () => {
    expect(validateAgentHandoffs([{ ...valid, model: 'openai:missing' }], ctx)).toEqual([
      { index: 0, field: 'model', code: 'model-invalid' },
    ]);
  });

  it('does not invent a duplicate-target error', () => {
    expect(validateAgentHandoffs([
      valid,
      { label: 'Again', agent: 'debugger', prompt: 'Continue.' },
    ], ctx)).toEqual([]);
  });

  it('allows an omitted model as inherit', () => {
    expect(validateAgentHandoffs([valid], ctx)).toEqual([]);
  });
});

describe('findProjectedHandoffTargetConflicts', () => {
  it('reports when another profile still hands off to a disabled target', () => {
    expect(findProjectedHandoffTargetConflicts([
      { id: 'general', enabled: true, handoffs: [valid] },
      { id: 'debugger', enabled: false, handoffs: [] },
    ])).toEqual([{ sourceId: 'general', targetId: 'debugger', code: 'target-disabled' }]);
  });
});

describe('persistAgentHandoff', () => {
  it('omits send:false after the send checkbox is cleared', () => {
    const cleared = persistAgentHandoff({ ...valid, send: true, showContinueOn: true });
    expect(cleared).toEqual({ ...valid, send: true, showContinueOn: true });
    expect(persistAgentHandoff({ ...cleared, send: false, showContinueOn: false })).toEqual(valid);
    expect(persistAgentHandoff({ ...cleared, send: undefined, model: '' })).toEqual({
      ...valid,
      showContinueOn: true,
    });
  });
});

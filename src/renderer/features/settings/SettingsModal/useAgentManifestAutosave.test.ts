import { describe, expect, it } from 'vitest';
import type { AgentManifestDraft } from '@shared/types/agentManifest';
import {
  getChangedAgentManifestDrafts,
  rollbackAgentManifestDrafts,
  serializeAgentManifestDraft,
} from './useAgentManifestAutosave';

const draft = (id: string, model: string): AgentManifestDraft => ({
  id,
  fileName: `${id}.agent.md`,
  name: id,
  description: '',
  argumentHint: '',
  target: 'rdc-agent',
  models: [model],
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
  enabled: true,
});

describe('agent manifest scoped autosave helpers', () => {
  it('ignores runtime-only fields and detects only persisted changes', () => {
    const saved = draft('ask', 'deepseek/a');
    const runtimeDecorated = {
      ...saved,
      filePath: 'C:/runtime/ask.agent.md',
      builtin: false,
      updatedAt: '2026-07-14T00:00:00.000Z',
    } as AgentManifestDraft;
    expect(serializeAgentManifestDraft(runtimeDecorated)).toBe(serializeAgentManifestDraft(saved));
    expect(getChangedAgentManifestDrafts([runtimeDecorated], [saved])).toEqual([]);
    expect(getChangedAgentManifestDrafts([{ ...runtimeDecorated, models: ['deepseek/c'] }], [saved]))
      .toEqual([expect.objectContaining({ models: ['deepseek/c'] })]);
    expect(getChangedAgentManifestDrafts([{ ...runtimeDecorated, accent: '#ff6a00' }], [saved]))
      .toEqual([expect.objectContaining({ accent: '#ff6a00' })]);
  });

  it('rolls back only the failed agent and preserves unrelated optimistic edits', () => {
    const saved = [draft('ask', 'deepseek/a'), draft('edit', 'deepseek/a')];
    const failed = { ...saved[0], models: ['deepseek/b'] };
    const unrelated = { ...saved[1], name: 'Edited locally' };
    expect(rollbackAgentManifestDrafts([failed, unrelated], [failed], saved)).toEqual([
      saved[0],
      unrelated,
    ]);
  });
});

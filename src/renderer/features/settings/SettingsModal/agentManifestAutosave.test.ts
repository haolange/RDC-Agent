import { describe, expect, it, vi } from 'vitest';
import type { AgentDefinitionSaveResult, AgentManifestDraft, AgentManifestDefinition } from '@shared/types/agentManifest';
import {
  applyAgentDefinitionSaveResults,
  getChangedAgentManifestDrafts,
  rollbackAgentManifestDrafts,
  selectSubmittableAgentManifestDrafts,
  serializeAgentManifestDraft,
  shouldRollbackFailedAgentManifestSave,
} from './useAgentManifestAutosave';
import { findProjectedHandoffTargetConflicts, persistAgentHandoff, validateAgentHandoffs } from './sections/agentHandoffValidation';

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

  it('replaces a deleted project general draft with the restored builtin and does not resubmit delete', () => {
    const projectDraft: AgentManifestDraft = {
      ...draft('general', 'openai:project'),
      delete: true,
      enabled: false,
      writeScope: 'project',
      writeProjectId: 'proj_demo',
      sourceHash: 'project-hash',
    };
    const restored: AgentManifestDefinition = {
      id: 'general',
      fileName: 'general.agent.md',
      filePath: 'builtin/general.agent.md',
      name: 'General',
      description: 'builtin',
      argumentHint: '',
      target: 'rdc-agent',
      models: [],
      icon: 'nodes',
      accent: '#33d1ff',
      disableModelInvocation: false,
      userInvocable: true,
      tools: ['read'],
      skills: [],
      mcpServers: [],
      agents: [],
      handoffs: [],
      metadata: {},
      instructions: 'builtin general',
      builtin: true,
      enabled: true,
      provenance: { scope: 'builtin', sourcePath: 'builtin/general.agent.md', sourceHash: 'builtin-hash' },
      compiledRoute: { agentId: 'general', providerId: 'openrouter', modelId: 'anthropic/claude-3-sonnet' },
    };
    const result: AgentDefinitionSaveResult = {
      clientRevision: 1,
      status: 'committed',
      commitHash: 'deleted-project',
      definition: restored,
      route: restored.compiledRoute ?? null,
      lastSuccessful: null,
    };
    const next = applyAgentDefinitionSaveResults([projectDraft], [projectDraft], [result], 'proj_demo');
    expect(next).toMatchObject([{
      id: 'general',
      writeScope: 'user',
      sourceHash: 'builtin-hash',
    }]);
    expect(next[0]?.delete).toBeUndefined();
    expect(getChangedAgentManifestDrafts(next, next)).toEqual([]);
  });

  it('removes a draft only when every scope is gone', () => {
    const doomed = { ...draft('only-mine', 'openai:a'), delete: true };
    const result: AgentDefinitionSaveResult = {
      clientRevision: 1,
      status: 'committed',
      commitHash: 'gone',
      definition: null,
      route: null,
      lastSuccessful: null,
    };
    expect(applyAgentDefinitionSaveResults([doomed, draft('keep', 'openai:b')], [doomed], [result])).toEqual([
      expect.objectContaining({ id: 'keep' }),
    ]);
  });

  it('blockSubmit intercepts without calling save', () => {
    const onSave = vi.fn();
    const saved = draft('general', 'openai:a');
    const current = {
      ...saved,
      handoffs: [{ label: 'WIP', agent: '', prompt: '' }],
    };
    const changed = getChangedAgentManifestDrafts([current], [saved]);
    const { drafts, blockedReason } = selectSubmittableAgentManifestDrafts(changed, (entry) => {
      const issues = validateAgentHandoffs(entry.handoffs, {
        selfId: entry.id,
        definitions: [],
        modelOptions: [],
      });
      return issues.length === 0 ? null : `blocked:${issues.length}`;
    });
    expect(changed).toHaveLength(1);
    expect(drafts).toEqual([]);
    expect(blockedReason).toBe('blocked:2');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('serializes a cleared send flag without send:false', () => {
    const saved = draft('general', 'openai:a');
    const withSend = {
      ...saved,
      handoffs: [persistAgentHandoff({
        label: 'Debug',
        agent: 'debugger',
        prompt: 'Investigate.',
        send: true,
      })],
    };
    const cleared = {
      ...saved,
      handoffs: [persistAgentHandoff({
        ...withSend.handoffs[0],
        send: false,
      })],
    };
    expect(withSend.handoffs[0]).toEqual({
      label: 'Debug',
      agent: 'debugger',
      prompt: 'Investigate.',
      send: true,
    });
    expect(cleared.handoffs[0]).toEqual({
      label: 'Debug',
      agent: 'debugger',
      prompt: 'Investigate.',
    });
    expect(JSON.stringify(cleared.handoffs[0])).not.toContain('"send"');
    expect(getChangedAgentManifestDrafts([cleared], [withSend])).toEqual([cleared]);
  });

  it('blocks disabling a target that another agent still hands off to and does not call save', () => {
    const onSave = vi.fn();
    const agentA = {
      ...draft('general', 'openai:a'),
      handoffs: [{ label: 'To debugger', agent: 'debugger', prompt: 'Investigate.' }],
    };
    const agentB = draft('debugger', 'openai:b');
    const saved = [agentA, agentB];
    const current = [agentA, { ...agentB, enabled: false }];
    const changed = getChangedAgentManifestDrafts(current, saved);
    const { drafts, blockedReason } = selectSubmittableAgentManifestDrafts(
      changed,
      (entry) => {
        const issues = validateAgentHandoffs(entry.handoffs, {
          selfId: entry.id,
          definitions: current,
          modelOptions: [],
        });
        return issues.length === 0 ? null : `blocked:${issues.length}`;
      },
      (projected) => {
        const conflict = findProjectedHandoffTargetConflicts(projected)[0];
        return conflict ? `blocked-by-other:${conflict.sourceId}->${conflict.targetId}` : null;
      },
      current,
    );
    expect(changed).toEqual([expect.objectContaining({ id: 'debugger', enabled: false })]);
    expect(drafts).toEqual([]);
    expect(blockedReason).toBe('blocked-by-other:general->debugger');
    expect(onSave).not.toHaveBeenCalled();
    expect(saved.find((entry) => entry.id === 'debugger')?.enabled).toBe(true);
    expect(agentA.handoffs).toEqual([{ label: 'To debugger', agent: 'debugger', prompt: 'Investigate.' }]);
  });

  it('does not rollback a later illegal handoff when an in-flight legal save fails', async () => {
    const saved = draft('general', 'openai:a');
    const legal = { ...saved, name: 'Renamed' };
    const illegal = {
      ...legal,
      handoffs: [{ label: 'WIP', agent: '', prompt: '' }],
    };
    let current = [legal];
    let latestRevision = 1;
    const submittedRevision = 1;
    const submitted = [legal];
    const onRollback = vi.fn((failed: AgentManifestDraft[], previous: AgentManifestDraft[]) => {
      current = rollbackAgentManifestDrafts(current, failed, previous);
    });

    const inFlight = new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error('save failed')), 20);
    }).catch(() => {
      if (!shouldRollbackFailedAgentManifestSave(submittedRevision, latestRevision, submitted, current)) {
        return;
      }
      onRollback(submitted, [saved]);
    });

    current = [illegal];
    latestRevision = 2;

    await inFlight;
    expect(onRollback).not.toHaveBeenCalled();
    expect(current).toEqual([illegal]);
    expect(shouldRollbackFailedAgentManifestSave(1, 1, submitted, submitted)).toBe(true);
  });
});

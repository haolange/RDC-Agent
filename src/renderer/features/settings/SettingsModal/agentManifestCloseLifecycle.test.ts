// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentManifestDefinition, AgentDefinitionSaveResult } from '@shared/types/agentManifest';
import { resolveAgentWriteTargetFromDraft } from '@shared/types/agentManifest';
import type { AppSettings } from '@shared/types/settings';
import { useSettingsModalState } from './useSettingsModalState';
import { useAgentManifestAutosave } from './useAgentManifestAutosave';
import type { AgentManifestSaveBatch } from './settingsModalActions';

const definition = (scope: 'project' | 'user'): AgentManifestDefinition => ({
  id: 'general', fileName: 'general.agent.md', filePath: '/general.agent.md', name: 'General',
  description: '', argumentHint: '', target: 'rdc-agent', models: [], icon: 'spark', accent: '#33d1ff',
  disableModelInvocation: false, userInvocable: true, tools: [], skills: [], mcpServers: [], agents: [],
  handoffs: [], metadata: {}, instructions: 'original', builtin: false, enabled: true,
  provenance: { scope, sourcePath: '/general.agent.md', sourceHash: 'original-hash' },
});
const makeSettings = (entry: AgentManifestDefinition) => ({
  profile: {}, llm: { providers: [], agentRoutes: [] },
  tooling: { rdcCli: {}, codeInterpreter: {}, shell: {} },
  agents: { definitions: [entry], globalInstructions: '' },
}) as unknown as AppSettings;

describe('mounted settings state and autosave close lifecycle', () => {
  let root: Root | undefined;
  let container: HTMLDivElement;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => {
    if (root) act(() => root?.unmount());
    root = undefined;
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function harness(scope: 'user' | 'project', initialProjectId: string | null) {
    let settings = makeSettings(definition(scope));
    let state!: ReturnType<typeof useSettingsModalState>;
    let open = true;
    let projectId = initialProjectId;
    const writes: Array<{ scope: string; projectId?: string; instructions: string }> = [];
    const save = vi.fn(async (batch: AgentManifestSaveBatch): Promise<AgentDefinitionSaveResult[]> => {
      return batch.drafts.map((draft) => {
        const target = resolveAgentWriteTargetFromDraft(draft, projectId);
        writes.push({ ...target, instructions: draft.instructions });
        const entry = { ...definition(scope), instructions: draft.instructions };
        settings = makeSettings(entry);
        return { clientRevision: batch.clientRevision, status: 'committed', commitHash: 'saved',
          definition: entry, route: null, lastSuccessful: null };
      });
    });
    function Probe() {
      state = useSettingsModalState(open, settings, projectId);
      useAgentManifestAutosave({
        open: open && state.agentManifestContextReady, settings,
        agentManifestDrafts: state.agentManifestAutosaveDrafts, currentProjectId: projectId,
        onSave: save, onRollback: vi.fn(), onSaveStateChange: state.setAgentManifestSaveState,
        onSaveMessageChange: state.setAgentManifestSaveMessage, onBlockedChange: state.setAgentManifestSaveBlocked,
        savedMessage: 'saved', failedMessage: 'failed',
      });
      return null;
    }
    act(() => { root = createRoot(container); root.render(createElement(Probe)); });
    return {
      save, writes, state: () => state,
      edit: () => act(() => state.setAgentManifestDrafts((drafts) => drafts.map((draft) => ({ ...draft, instructions: 'last edit' })))),
      render: async (nextOpen: boolean, nextProjectId = projectId) => {
        open = nextOpen; projectId = nextProjectId;
        await act(async () => { root!.render(createElement(Probe)); });
      },
    };
  }

  it.each(['user', 'project'] as const)('flushes %s edits before 300ms on close, preserving ownership and reopening saved text', async (scope) => {
    const test = harness(scope, 'project-a');
    test.edit();
    act(() => vi.advanceTimersByTime(100));
    expect(test.save).not.toHaveBeenCalled();
    await test.render(false);
    expect(test.writes).toEqual([{ scope, ...(scope === 'project' ? { projectId: 'project-a' } : {}), instructions: 'last edit' }]);
    expect(test.state().agentManifestDrafts).toEqual([]);
    await test.render(true);
    expect(test.state().agentManifestDrafts[0].instructions).toBe('last edit');
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(test.save).toHaveBeenCalledTimes(1);
  });

  it('never submits startup project profiles without a ready identity', async () => {
    const test = harness('project', null);
    expect(test.state().agentManifestAutosaveDrafts).toEqual([]);
    await test.render(false);
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(test.save).not.toHaveBeenCalled();
    await test.render(true, 'project-a');
    expect(test.state().agentManifestDrafts[0].writeProjectId).toBe('project-a');
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(test.save).not.toHaveBeenCalled();
  });

  it('does not flush old project drafts under a new project identity', async () => {
    const test = harness('project', 'project-a');
    test.edit();
    await test.render(false, 'project-b');
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(test.save).not.toHaveBeenCalled();
    expect(test.state().agentManifestAutosaveDrafts).toEqual([]);
  });
});

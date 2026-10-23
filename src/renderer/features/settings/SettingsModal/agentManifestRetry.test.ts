// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AgentDefinitionSaveRequest, AgentManifestDefinition } from '@shared/types/agentManifest';
import { DEFAULT_SETTINGS } from '../../../stores/defaultAppSettings';
import { useSettingsModal } from './useSettingsModal';

const mocks = vi.hoisted(() => ({ save: vi.fn(), revision: 0 }));
vi.mock('../../../stores/appSettingsStore', () => ({
  nextAgentDefinitionClientRevision: () => ++mocks.revision,
  useAppSettingsStore: (select: (state: object) => unknown) => select({ saveAgentDefinition: mocks.save }),
}));
vi.mock('../../../stores/projectStore', () => ({ useProjectStore: (select: (state: object) => unknown) => select({ currentProject: null }) }));
vi.mock('../../../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('./useProviderConnection', () => ({ useProviderConnection: () => ({}) }));

const definition = (id: string): AgentManifestDefinition => ({
  id, fileName: `${id}.agent.md`, filePath: `/builtin/${id}.agent.md`, name: id,
  description: '', argumentHint: '', target: 'rdc-agent', models: [], icon: 'spark', accent: '#33d1ff',
  disableModelInvocation: false, userInvocable: true, tools: [], skills: [], mcpServers: [], agents: [],
  handoffs: [], metadata: {}, instructions: 'original', builtin: true, enabled: true, maxTurns: 50,
  provenance: { scope: 'builtin', sourcePath: `/builtin/${id}.agent.md`, sourceHash: `${id}:builtin` },
});
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('electronAPI', undefined);
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { settings: { getProviderCatalog: async () => ({}) } } });
  mocks.save.mockReset(); mocks.revision = 0;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

function harness() {
  const entries = [definition('general'), definition('analyzer')];
  const settings = { ...DEFAULT_SETTINGS, agents: { ...DEFAULT_SETTINGS.agents, definitions: entries } };
  const disk = new Map(entries.map(entry => [entry.id, entry]));
  let failure = false;
  let editor!: ReturnType<typeof useSettingsModal>;
  mocks.save.mockImplementation(async (request: AgentDefinitionSaveRequest) => {
    const current = disk.get(request.draft.id)!;
    if (request.sourceHash !== current.provenance!.sourceHash) throw new Error('AGENT_MANIFEST_SOURCE_HASH_CONFLICT');
    if (failure && request.draft.id === 'general') throw new Error('EPERM: rename');
    const next = { ...current, ...request.draft, builtin: false,
      provenance: { scope: 'user' as const, sourcePath: `/user/${current.fileName}`, sourceHash: `${current.id}:${request.draft.maxTurns}` } };
    disk.set(current.id, next);
    return { clientRevision: request.clientRevision, status: 'committed', commitHash: next.provenance.sourceHash,
      definition: next, route: null, lastSuccessful: null };
  });
  function Probe() { editor = useSettingsModal(true, settings); return null; }
  act(() => root.render(createElement(Probe)));
  return {
    disk, editor: () => editor,
    fail: (value: boolean) => { failure = value; },
    edit: (value: number) => act(() => editor.setAgentManifestDrafts(drafts => drafts.map(draft => draft.id === 'general' ? { ...draft, maxTurns: value } : draft))),
    settle: () => act(async () => { await vi.advanceTimersByTimeAsync(500); }),
    retry: () => act(async () => { await editor.handleSaveAgentManifests(); }),
  };
}

it('retries only the failed execution limit in the same editor, with its intended value and original compare hash', async () => {
  const test = harness(); test.edit(101); await test.settle();
  expect(test.disk.get('general')!.maxTurns).toBe(101);
  test.fail(true); test.edit(102); await test.settle();
  expect(test.editor().agentManifestSaveState).toBe('error');
  const start = mocks.save.mock.calls.length;
  await test.retry();
  const requests = mocks.save.mock.calls.slice(start).map(([request]) => request);
  expect(requests).toEqual([expect.objectContaining({ draft: expect.objectContaining({ id: 'general', maxTurns: 102 }), sourceHash: 'general:101' })]);
  expect(test.disk.get('analyzer')!.provenance!.scope).toBe('builtin');
  test.fail(false); await test.retry();
  expect(test.editor().agentManifestSaveState).toBe('saved');
  expect(test.disk.get('general')!.maxTurns).toBe(102);
  test.edit(103); await test.settle();
  expect(test.disk.get('general')!.maxTurns).toBe(103);
  expect(mocks.save.mock.calls.every(([request]) => request.draft.id === 'general')).toBe(true);
});

it('still rejects a real external edit on retry instead of refreshing away the conflict', async () => {
  const test = harness(); test.edit(101); await test.settle();
  test.fail(true); test.edit(102); await test.settle(); test.fail(false);
  const current = test.disk.get('general')!;
  test.disk.set('general', { ...current, maxTurns: 777, provenance: { ...current.provenance!, sourceHash: 'external' } });
  await test.retry();
  expect(test.editor().agentManifestSaveState).toBe('error');
  expect(test.editor().agentManifestSaveMessage).toContain('SOURCE_HASH_CONFLICT');
  expect(test.disk.get('general')!.maxTurns).toBe(777);
  expect(mocks.save.mock.lastCall![0].sourceHash).toBe('general:101');
  await test.retry();
  expect(test.disk.get('general')!.maxTurns).toBe(777);
  expect(mocks.save.mock.lastCall![0].sourceHash).toBe('general:101');
});

it('retries a newer edit instead of the rolled-back attempt and cancels its pending debounce', async () => {
  const test = harness(); test.edit(101); await test.settle();
  test.fail(true); test.edit(102); await test.settle(); test.fail(false);
  const start = mocks.save.mock.calls.length;
  test.edit(104); await test.retry(); await test.settle();
  expect(test.disk.get('general')!.maxTurns).toBe(104);
  expect(mocks.save.mock.calls.slice(start)).toHaveLength(1);
  expect(test.editor().agentManifestSaveState).toBe('saved');
});

it('keeps the handoff validation gate on the real Retry entry', async () => {
  const test = harness(); test.edit(101); await test.settle();
  test.fail(true); test.edit(102); await test.settle();
  act(() => test.editor().setAgentManifestDrafts(drafts => drafts.map(draft => draft.id === 'general'
    ? { ...draft, handoffs: [{ label: 'WIP', agent: '', prompt: '' }] } : draft)));
  const calls = mocks.save.mock.calls.length;
  await test.retry();
  expect(mocks.save).toHaveBeenCalledTimes(calls);
  expect(test.editor().agentManifestSaveBlocked).toBe(true);
  expect(test.editor().agentManifestSaveState).toBe('error');
});

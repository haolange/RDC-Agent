// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { AgentsSettings, createNewAgent } from './AgentsSettings';
import { useSettingsNavigationStore } from '../../../../stores/settingsNavigationStore';

vi.mock('../useScopedSkillSelection', () => ({ useScopedSkillSelection: () => ({}) }));
vi.mock('./AgentManifestEditor', () => ({ AgentManifestEditor: ({ selectedAgent }: { selectedAgent: { id: string } }) =>
  React.createElement('div', { 'data-testid': 'selected-agent' }, selectedAgent.id) }));
vi.mock('./AgentListItem', () => ({ AgentListItem: ({ id, onSelect }: { id: string; onSelect: () => void }) =>
  React.createElement('button', { type: 'button', onClick: onSelect }, id) }));

const t = ((key: string, params?: Record<string, string>) => `${key}${params?.id ? `:${params.id}` : ''}`) as Parameters<typeof createNewAgent>[1];
const first = createNewAgent([], t, 'user', 'project-a');
const target = { ...createNewAgent([first], t, 'project', 'project-a'), id: 'target' };
const other = { ...createNewAgent([first, target], t, 'project', 'project-a'), id: 'other' };
const settings = { agents: { definitions: [], diagnostics: [] } } as never;

it('waits for drafts, opens the target scope once, and reports a missing target without selecting another', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const render = (ready: boolean) => root.render(React.createElement(AgentsSettings, { settings,
    agentManifestDrafts: ready ? [first, target, other] : [], agentManifestContextReady: ready,
    onAgentManifestDraftsChange: () => undefined, onRetrySaveAgentManifests: () => undefined,
    onImportAgentManifest: () => undefined, agentManifestSaveState: 'idle', agentManifestSaveMessage: '',
    canProject: true, currentProjectId: 'project-a', t }));
  try {
    useSettingsNavigationStore.getState().openAgent('target');
    await act(async () => render(false));
    expect(useSettingsNavigationStore.getState().agentRequest?.agentId).toBe('target');
    await act(async () => render(true));
    expect(host.querySelector('[data-testid="selected-agent"]')?.textContent).toBe('target');
    expect(useSettingsNavigationStore.getState().agentRequest).toBeNull();
    await act(async () => [...host.querySelectorAll('button')].find((button) => button.textContent === 'other')!.click());
    await act(async () => render(true));
    expect(host.querySelector('[data-testid="selected-agent"]')?.textContent).toBe('other');
    await act(async () => useSettingsNavigationStore.getState().openAgent('removed'));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('removed');
    expect(host.querySelector('[data-testid="selected-agent"]')).toBeNull();
    await act(async () => [...host.querySelectorAll('button')].find((button) => button.textContent === 'target')!.click());
    expect(host.querySelector('[data-testid="selected-agent"]')?.textContent).toBe('target');
  } finally {
    await act(async () => root.unmount()); host.remove();
    useSettingsNavigationStore.getState().clearAgentRequest(); vi.unstubAllGlobals();
  }
});

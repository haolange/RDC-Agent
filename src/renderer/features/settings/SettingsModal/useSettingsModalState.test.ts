import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { toAgentManifestEditorDraft, type AgentManifestDefinition } from '@shared/types/agentManifest';
import type { AppSettings } from '@shared/types/settings';
import { canInitializeAgentEditor, useSettingsModalState } from './useSettingsModalState';

const projectAgent: AgentManifestDefinition = {
  id: 'general', fileName: 'general.agent.md', filePath: '/project/general.agent.md', name: 'General',
  description: '', argumentHint: '', target: 'rdc-agent', models: [], icon: 'spark', accent: '#33d1ff',
  disableModelInvocation: false, userInvocable: true, tools: [], skills: [], mcpServers: [], agents: [],
  handoffs: [], metadata: {}, instructions: 'project instructions', builtin: false, enabled: true,
  provenance: { scope: 'project', sourcePath: '/project/general.agent.md', sourceHash: 'project-hash' },
};

// Only the fields read by this state hook: no IPC, registry mutation or project-data deletion.
const settings = {
  profile: {}, llm: { providers: [], agentRoutes: [] },
  tooling: { rdcCli: {}, codeInterpreter: {}, shell: {} },
  agents: { definitions: [projectAgent], globalInstructions: '' },
} as unknown as AppSettings;

describe('settings editor project restoration', () => {
  it.each([false, true])('does not convert project profiles during render with open=%s and null selection', (open) => {
    function Probe() {
      const state = useSettingsModalState(open, settings, null);
      return createElement('span', null, `${state.agentManifestContextReady}:${state.agentManifestDrafts.length}`);
    }
    expect(renderToStaticMarkup(createElement(Probe))).toContain('false:0');
  });

  it('waits for identity, then retains exact project ownership and original content', () => {
    expect(canInitializeAgentEditor([projectAgent], null)).toBe(false);
    expect(canInitializeAgentEditor([projectAgent], '  ')).toBe(false);
    expect(canInitializeAgentEditor([projectAgent], 'registered-project')).toBe(true);
    const draft = toAgentManifestEditorDraft(projectAgent, 'registered-project');
    expect(draft).toMatchObject({ writeScope: 'project', writeProjectId: 'registered-project',
      sourceHash: 'project-hash', instructions: 'project instructions' });
    expect(projectAgent.provenance?.scope).toBe('project');
    expect(() => toAgentManifestEditorDraft(projectAgent, null)).toThrow('AGENT_MANIFEST_PROJECT_ID_REQUIRED');
  });

  it('allows genuinely user-only settings without manufacturing a project identity', () => {
    expect(canInitializeAgentEditor([], null)).toBe(true);
    expect(canInitializeAgentEditor([{ ...projectAgent, provenance: { ...projectAgent.provenance!, scope: 'user' } }], null)).toBe(true);
  });
});

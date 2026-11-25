import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAgentModelControls } from './useAgentModelControls';
import type { AgentModelSettings, AppSettings } from '@shared/types/settings';

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

/**
 * Two Agents edited before the first save returns: each edit is computed from the settings the page last received,
 * so the second write carries a byAgent map without the first edit and replaces it. Known loss until model routes are
 * written as field-level patches; the test turns green then and `it.fails` reports it.
 */
it.fails('keeps both Agents when their models are changed before the first save returns', async () => {
  const writes: AgentModelSettings[] = [];
  const settings = { agentModels: { default: {}, byAgent: {} } } as unknown as AppSettings;
  let controls!: ReturnType<typeof useAgentModelControls>;
  const Probe = () => {
    controls = useAgentModelControls(settings, {
      onAgentModelsChange: async (agentModels: AgentModelSettings) => { writes.push(agentModels); },
    } as never, ((key: string) => key) as never);
    return null;
  };
  await act(async () => root.render(createElement(Probe)));

  await act(async () => {
    controls.setAgentBinding('debugger', { model: 'ollama:local-model' });
    controls.setAgentBinding('analyzer', { model: 'ollama:other-model' });
  });

  expect(writes.at(-1)?.byAgent).toEqual({
    debugger: { model: 'ollama:local-model' },
    analyzer: { model: 'ollama:other-model' },
  });
});

// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useSettingsModalState } from './useSettingsModalState';
import type { AppSettings, LlmProviderEntry } from '@shared/types/settings';

it('a closed Settings modal copies the providers once, not on every render', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let reads = 0;
  const provider = {
    id: 'provider-a',
    providerAvailability: {},
    catalogProvenance: [],
    models: [],
    recommendedModels: [],
    // Every copy of the provider (cloneProvider) reads this field.
    get authModeOptions() {
      reads += 1;
      return undefined;
    },
  } as unknown as LlmProviderEntry;
  const settings = {
    profile: {},
    llm: { providers: [provider], agentRoutes: [] },
    tooling: { rdcCli: {}, codeInterpreter: {}, shell: {} },
    agents: { definitions: [], globalInstructions: '' },
  } as unknown as AppSettings;
  function Probe({ tick }: { tick: number }) {
    const state = useSettingsModalState(false, settings, null);
    return createElement('span', null, `${tick}:${state.providerDrafts.length}`);
  }
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(Probe, { tick: 0 })));
    const readsOfFirstRender = reads;
    expect(readsOfFirstRender).toBeGreaterThan(0);
    for (let tick = 1; tick < 5; tick += 1) await act(async () => root.render(createElement(Probe, { tick })));
    expect(host.textContent).toBe('4:1');
    expect(reads).toBe(readsOfFirstRender);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

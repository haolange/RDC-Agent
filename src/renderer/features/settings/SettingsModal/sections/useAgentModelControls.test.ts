import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { applyAgentModelOp, isAgentModelPatchOp } from '@shared/utils/settingsPatch';
import { useAgentModelControls } from './useAgentModelControls';
import type { AgentModelSettings, SettingsPatchOp } from '@shared/types/settings';

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

/**
 * Two Agents edited before the first save returns: each control commits only the field it changed, so neither
 * write carries — or replaces — the other Agent's binding.
 */
it('keeps both Agents when their models are changed before the first save returns', async () => {
  const writes: SettingsPatchOp[][] = [];
  let controls!: ReturnType<typeof useAgentModelControls>;
  const Probe = () => {
    controls = useAgentModelControls({
      onAgentModelOps: async (ops: SettingsPatchOp[]) => {
        writes.push(ops);
      },
    } as never);
    return null;
  };
  await act(async () => root.render(createElement(Probe)));

  await act(async () => {
    controls.setAgentField('debugger', { field: 'model', value: 'ollama:local-model' });
    controls.setAgentField('analyzer', { field: 'model', value: 'ollama:other-model' });
  });

  const committed = writes
    .flat()
    .filter(isAgentModelPatchOp)
    .reduce<AgentModelSettings>(applyAgentModelOp, { default: {}, byAgent: {} });
  expect(committed.byAgent).toEqual({
    debugger: { model: 'ollama:local-model' },
    analyzer: { model: 'ollama:other-model' },
  });
});

it('clears an Agent field and the default field instead of writing whole bindings', async () => {
  const writes: SettingsPatchOp[][] = [];
  let controls!: ReturnType<typeof useAgentModelControls>;
  const Probe = () => {
    controls = useAgentModelControls({
      onAgentModelOps: async (ops: SettingsPatchOp[]) => {
        writes.push(ops);
      },
    } as never);
    return null;
  };
  await act(async () => root.render(createElement(Probe)));
  await act(async () => {
    controls.setAgentField('debugger', { field: 'reasoningLevel' });
    controls.setDefaultField({ field: 'model' });
  });
  expect(writes).toEqual([
    [{ op: 'agentModels.clearAgentField', agentId: 'debugger', field: 'reasoningLevel' }],
    [{ op: 'agentModels.setDefault', field: 'model', value: null }],
  ]);
});

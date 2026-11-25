import { describe, expect, it } from 'vitest';
import { createDefaultAppSettings } from '../constants/appSettingsDefaults';
import {
  applyAgentModelChanges,
  applyAgentModelOp,
  applySettingsPatchOps,
  diffAgentModels,
  type SettingsPatchView,
} from './settingsPatch';
import type { AgentModelSettings } from '../types/settings';

const view = (): SettingsPatchView => {
  const settings = createDefaultAppSettings();
  return {
    appearance: settings.appearance,
    layout: settings.layout,
    profile: settings.profile,
    tooling: settings.tooling,
    agentRuntime: settings.agentRuntime,
    agentModels: { default: {}, byAgent: {} },
    globalInstructions: '',
  };
};

describe('settings patch ops', () => {
  it('sets and clears one field of a binding and drops an Agent binding left empty', () => {
    let models: AgentModelSettings = { default: { model: 'a:one', reasoningLevel: 'high' }, byAgent: {} };
    models = applyAgentModelOp(models, { op: 'agentModels.setDefault', field: 'reasoningLevel', value: null });
    expect(models.default).toEqual({ model: 'a:one' });
    models = applyAgentModelOp(models, { op: 'agentModels.setAgentField', agentId: 'debugger', field: 'model', value: 'a:two' });
    models = applyAgentModelOp(models, { op: 'agentModels.setAgentField', agentId: 'debugger', field: 'reasoningLevel', value: 'low' });
    expect(models.byAgent).toEqual({ debugger: { model: 'a:two', reasoningLevel: 'low' } });
    models = applyAgentModelOp(models, { op: 'agentModels.clearAgentField', agentId: 'debugger', field: 'model' });
    expect(models.byAgent).toEqual({ debugger: { reasoningLevel: 'low' } });
    models = applyAgentModelOp(models, { op: 'agentModels.clearAgentField', agentId: 'debugger', field: 'reasoningLevel' });
    expect(models.byAgent).toEqual({});
  });

  it('keeps edits of different Agents and fields made from the same starting point', () => {
    const start = view();
    const next = applySettingsPatchOps(start, [
      { op: 'agentModels.setAgentField', agentId: 'debugger', field: 'model', value: 'ollama:local-model' },
      { op: 'agentModels.setAgentField', agentId: 'analyzer', field: 'model', value: 'ollama:other-model' },
      { op: 'layout', value: { leftSidebar: { width: 300 } } },
      { op: 'layout', value: { terminal: { height: 280 } } },
    ]);
    expect(next.agentModels.byAgent).toEqual({ debugger: { model: 'ollama:local-model' }, analyzer: { model: 'ollama:other-model' } });
    expect(next.layout.leftSidebar).toEqual({ ...start.layout.leftSidebar, width: 300 });
    expect(next.layout.terminal.height).toBe(280);
    expect(next.layout.rightPanel).toBe(start.layout.rightPanel);
  });

  it('describes changed bindings only and applies them back', () => {
    const before: AgentModelSettings = { default: { model: 'a:one' }, byAgent: { debugger: { model: 'a:two' }, analyzer: { model: 'a:three' } } };
    const after: AgentModelSettings = { default: { model: 'a:one' }, byAgent: { analyzer: { model: 'a:four' } } };
    const changes = diffAgentModels(before, after);
    expect(changes).toEqual({ byAgent: { debugger: null, analyzer: { model: 'a:four' } } });
    expect(applyAgentModelChanges(before, changes!)).toEqual(after);
    expect(diffAgentModels(after, after)).toBeUndefined();
  });
});

// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { AgentManifestDraft } from '@shared/types/agentManifest';
import { AgentExecutionLimitField } from './AgentExecutionLimitField';
import { getChangedAgentManifestDrafts } from '../agentManifestAutosaveState';

it('saves a deliberate future limit through the manifest draft and rejects invalid limits', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const update = vi.fn();
  const agent = { id: 'general', maxTurns: 50 } as AgentManifestDraft;
  const render = () => act(() => root.render(createElement(AgentExecutionLimitField, {
    agent, onUpdateAgent: update, t: ((key: string) => key) as never,
  })));
  const commit = (value: string) => {
    const input = host.querySelector('input')!;
    input.value = value;
    act(() => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    return input;
  };
  try {
    render();
    expect(host.querySelector('input')!.value).toBe('50');
    commit('100'); expect(update).toHaveBeenLastCalledWith({ maxTurns: 100 });
    expect(getChangedAgentManifestDrafts([{ ...agent, maxTurns: 100 }], [agent])).toHaveLength(1);
    update.mockClear();
    for (const invalid of ['0', '-1', '1.5', '9007199254740992']) {
      expect(commit(invalid).value).toBe('50');
    }
    expect(update).not.toHaveBeenCalled();
    commit(''); expect(update).toHaveBeenLastCalledWith({ maxTurns: undefined });
    agent.id = 'debugger'; agent.maxTurns = 12; render();
    expect(host.querySelector('input')!.value).toBe('12');
  } finally { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});

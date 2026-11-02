// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { AgentHandoffDefinition } from '@shared/types/agentManifest';
import { AgentHandoffCard } from './AgentHandoffCard';

it('edits and clears optional locale labels while retaining them through default-label edits', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  let handoff: AgentHandoffDefinition = { label: 'Implement Plan', agent: 'general', prompt: 'Run' };
  const render = () => root.render(createElement(AgentHandoffCard, {
    index: 0, handoff, issues: [], targets: [], modelOptions: [],
    skills: { catalog: null, loading: false, enabled: false, error: '', refresh: vi.fn() },
    forceShowRequired: false, isFirst: true, isLast: true, expanded: true,
    t: key => key, onToggle: vi.fn(), onChange: next => { handoff = next; render(); },
    onMoveUp: vi.fn(), onMoveDown: vi.fn(), onDelete: vi.fn(), labelRef: vi.fn(), deleteRef: vi.fn(),
  }));
  const input = async (index: number, value: string) => act(async () => {
    const element = host.querySelectorAll('input')[index];
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  try {
    await act(async () => render());
    expect(host.querySelector<HTMLLabelElement>('label[for="settings-handoff-label-en-0"]')?.control)
      .toBe(host.querySelector('#settings-handoff-label-en-0'));
    await input(1, '执行计划'); await input(2, 'Implement'); await input(0, 'Run plan');
    expect(handoff).toMatchObject({ label: 'Run plan', labelTranslations: { 'zh-CN': '执行计划', en: 'Implement' } });
    await input(1, ''); expect(handoff.labelTranslations).toEqual({ en: 'Implement' });
    await input(2, ''); expect(handoff.labelTranslations).toBeUndefined();
  } finally {
    await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals();
  }
});

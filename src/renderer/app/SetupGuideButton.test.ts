import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { SetupGuideButton } from './SetupGuideButton';

const openModels = vi.hoisted(() => vi.fn());
vi.mock('../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('../hooks/useWorkbenchSetup', () => ({
  useWorkbenchSetup: () => [
    { id: 'rdcTool', done: true, act: vi.fn() },
    { id: 'model', done: false, act: openModels },
    { id: 'project', done: false, act: vi.fn() },
  ],
}));

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

it('reopens the setup checklist from the title bar and closes it when a step is acted on', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(SetupGuideButton)));
    const trigger = host.querySelector<HTMLButtonElement>('[data-testid="titlebar-setup-guide"]')!;
    expect(trigger.getAttribute('aria-label')).toBe('setup.reopen');
    expect(document.querySelector('[data-testid="setup-checklist"]')).toBeNull();

    await act(async () => trigger.click());
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('[data-testid="setup-step-rdcTool"]')?.getAttribute('data-state')).toBe('done');
    const action = document.querySelector<HTMLButtonElement>('[data-testid="setup-step-model"] button')!;

    await act(async () => action.click());
    expect(openModels).toHaveBeenCalledOnce();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  } finally {
    await act(async () => root.unmount());
  }
});

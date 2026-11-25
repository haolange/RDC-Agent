import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { translate } from '../../../../i18n/messages';
import { useProviderProbeBatch } from '../useProviderProbeBatch';
import { ProviderProbeBatchPanel } from './ProviderProbeBatchPanel';
import type { ProviderProbeBatch } from '@shared/types/providerProbe';
vi.mock('../../../../i18n', () => ({ useI18n: () => ({
  t: (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) => translate('en', key, params),
}) }));

vi.mock('../useProviderProbeBatch', () => ({ useProviderProbeBatch: vi.fn() }));

it('opens a service preview and waits for explicit confirmation to send requests', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const action = vi.fn();
  const state = { busy: false, occupied: false, error: '', action };
  const props: Parameters<typeof ProviderProbeBatchPanel>[0] = {
    providerIds: ['service'],
  };
  try {
    vi.mocked(useProviderProbeBatch).mockReturnValue({ ...state, batch: null });
    await act(async () => root.render(createElement(ProviderProbeBatchPanel, props)));
    expect(host.querySelector('section')).toBeNull();
    await act(async () => host.querySelector('button')!.click());
    expect(action.mock.calls).toEqual([['prepare']]);
    vi.mocked(useProviderProbeBatch).mockReturnValue({ ...state, batch: {
      id: 'preview', revision: 1, state: 'ready', modelCount: 1, requestCount: 1, discoveryErrors: [],
      items: [{ providerId: 'service', modelId: 'model', mode: 'default', state: 'pending' }],
    } });
    await act(async () => root.render(createElement(ProviderProbeBatchPanel, props)));
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.querySelector('dl')?.textContent).toContain('Planned requests1');
    const start = Array.from(dialog.querySelectorAll<HTMLButtonElement>('footer button')).find(button => button.textContent === 'Start check')!;
    await act(async () => start.click());
    expect(action.mock.calls).toEqual([['prepare'], ['start']]);
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});

it('keeps the closed launcher informative without treating an inconclusive check as a failure', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const batch: ProviderProbeBatch = {
    id: 'check', revision: 2, state: 'completed', modelCount: 2, requestCount: 2, discoveryErrors: [],
    items: [
      { providerId: 'service', modelId: 'fast', mode: 'fast', state: 'settled',
        result: { success: false, requestSent: true, status: 'inconclusive' } },
      { providerId: 'service', modelId: 'default', mode: 'default', state: 'settled',
        result: { success: false, requestSent: true, status: 'denied' } },
    ],
  };
  const action = vi.fn();
  vi.mocked(useProviderProbeBatch).mockReturnValue({ batch, busy: false, occupied: false, error: '', action });
  try {
    await act(async () => root.render(createElement(ProviderProbeBatchPanel, {})));
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Completed · 2/2 processed · 1 failed');
    await act(async () => host.querySelector('button')!.click());
    expect(document.querySelector('[role="dialog"] [data-testid="settings-provider-probe-batch"]')).toBeTruthy();
    expect(action).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});

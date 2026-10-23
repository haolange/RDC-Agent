// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import type { LlmProviderEntry } from '@shared/types/settings';
import { createProviderConnectionDraft } from './providerConnectionState';
import { useProviderConnectionActions } from './useProviderConnectionActions';

afterEach(() => { Reflect.deleteProperty(window, 'electronAPI'); });
it.each([true, false])('uses the actual account result after stored-credential verification succeeds=%s', async (success) => {
  const provider = { id: 'chatgpt-account', authMode: 'account', models: [] } as unknown as LlmProviderEntry;
  const draft = createProviderConnectionDraft(provider);
  const status = { providerId: provider.id, state: 'connected', connected: true, available: true };
  const refresh = vi.fn(async () => ({ success, models: [], error: success ? undefined : 'credential rejected' }));
  const getStatus = vi.fn(async () => status), update = vi.fn(), reload = vi.fn();
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { llm: {
    refreshProviderModels: refresh, getProviderAccountStatus: getStatus,
  } } });
  const actions = useProviderConnectionActions(draft, vi.fn(), [provider], vi.fn(), {
    connectionProvider: provider, refreshLocalSettings: reload, updateConnectionDraft: update,
  } as never, ((key: string) => key) as never);
  await actions.handleTestProviderDraft();
  expect(refresh).toHaveBeenCalledExactlyOnceWith(provider.id);
  if (success) {
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ accountStatus: status, busy: 'idle' }));
    expect(reload).toHaveBeenCalledExactlyOnceWith(provider.id);
  } else {
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ error: 'credential rejected' }));
    expect(getStatus).not.toHaveBeenCalled(); expect(reload).not.toHaveBeenCalled();
  }
});

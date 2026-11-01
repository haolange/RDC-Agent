import { expect, it, vi } from 'vitest';
import type { ElectronAPI } from '@shared/types/electron';
import { refreshEffectiveCatalog } from './effectiveCatalogService';

it('uses the provider refresh action and preserves its failure', async () => {
  const refreshProviderModels = vi.fn().mockResolvedValueOnce({ success: false, error: 'Account is not connected.' })
    .mockResolvedValueOnce({ success: true });
  const api = { llm: { refreshProviderModels } } as unknown as ElectronAPI;
  await expect(refreshEffectiveCatalog(api, 'grok-account')).rejects.toThrow('Account is not connected.');
  await refreshEffectiveCatalog(api, 'grok-account');
  expect(refreshProviderModels).toHaveBeenLastCalledWith('grok-account');
  await expect(refreshEffectiveCatalog(undefined, 'grok-account')).rejects.toThrow('bridge is unavailable');
});

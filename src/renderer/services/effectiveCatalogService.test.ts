import { expect, it, vi } from 'vitest';
import type { ElectronAPI } from '@shared/types/electron';
import { refreshEffectiveCatalog } from './effectiveCatalogService';

it('uses the provider refresh action and preserves its failure', async () => {
  const refreshProviderModels = vi.fn().mockResolvedValueOnce({ success: false, error: 'Account is not connected.' })
    .mockResolvedValueOnce({ success: true });
  const api = { llm: { refreshProviderModels } } as unknown as ElectronAPI;
  const scope = { accountId: 'a', protocol: 'OpenAIResponses' as const };
  await expect(refreshEffectiveCatalog(api, 'grok-account', scope)).rejects.toThrow('Account is not connected.');
  await refreshEffectiveCatalog(api, 'grok-account', scope);
  expect(refreshProviderModels).toHaveBeenLastCalledWith('grok-account', scope);
  await expect(refreshEffectiveCatalog(undefined, 'grok-account', scope)).rejects.toThrow('bridge is unavailable');
});

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => process.cwd(), getAppPath: () => process.cwd() },
  safeStorage: { isEncryptionAvailable: () => false },
}));

import { secretStorageService } from './SecretStorageService';
import {
  isVendorSecretUsable,
  resolveAccountRuntimeCredential,
  resolveProviderModels,
} from './settingsProviderSanitize';

describe('provider facts read from manifests', () => {
  afterEach(() => vi.restoreAllMocks());

  it('treats a stored key without the declared prefix as unusable', () => {
    expect(isVendorSecretUsable('openai', 'sk-fixture')).toBe(true);
    expect(isVendorSecretUsable('openai', 'fixture')).toBe(false);
    expect(isVendorSecretUsable('anthropic', 'sk-fixture')).toBe(false);
    expect(isVendorSecretUsable('deepseek', 'fixture')).toBe(true);
  });

  it('drops a retired model from persisted rows', () => {
    const models = resolveProviderModels('chatgpt-account', [
      { id: 'gpt-5.5', label: 'GPT-5.5', enabled: true },
      { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', enabled: true },
    ]);
    expect(models.map((model) => model.id)).not.toContain('gpt-5.5');
  });

  it('maps account bundles through the declared credential fields and route base URL', () => {
    const bundles: Record<string, string> = {
      'github-copilot': JSON.stringify({ providerId: 'github-copilot', accessToken: 'gh-fixture', copilotToken: 'cp-fixture' }),
      nous: JSON.stringify({ providerId: 'nous', accessToken: 'nous-fixture', resourceUrl: 'https://nous.example/v1', accountId: 'n1' }),
      openrouter: JSON.stringify({ providerId: 'openrouter', apiKey: 'sk-or-fixture', accessToken: 'unused' }),
    };
    vi.spyOn(secretStorageService, 'getSecret').mockImplementation((ref) => (
      Object.entries(bundles).find(([providerId]) => String(ref).includes(providerId))?.[1] ?? ''
    ));
    expect(resolveAccountRuntimeCredential({ id: 'github-copilot', activeAccountId: 'a1' }, '/fixture')).toEqual({
      apiKey: 'cp-fixture',
      baseUrl: 'https://api.githubcopilot.com',
      accountId: undefined,
    });
    expect(resolveAccountRuntimeCredential({ id: 'nous', activeAccountId: 'a1' }, '/fixture')).toEqual({
      apiKey: 'nous-fixture',
      baseUrl: 'https://nous.example/v1',
      accountId: 'n1',
    });
    expect(resolveAccountRuntimeCredential({ id: 'openrouter', activeAccountId: 'a1' }, '/fixture')).toMatchObject({
      apiKey: 'sk-or-fixture',
      baseUrl: 'https://openrouter.ai/api/v1',
    });
    expect(resolveAccountRuntimeCredential({ id: 'deepseek', activeAccountId: 'a1' }, '/fixture')).toEqual({ apiKey: '' });
  });
});

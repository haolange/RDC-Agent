import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: () => process.env.TEMP ?? process.env.TMP ?? process.cwd(),
    getAppPath: () => process.cwd(),
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    decryptString: () => '',
    encryptString: (value: string) => Buffer.from(value),
  },
}));

import { createTestRequestPlan } from '../../testing/createTestRequestPlan';
import { encodeAgentModel, configuredRuntimeProvider } from './ConfiguredRuntimeProvider';
import { providerRuntimeCredentialService } from '../../settings/ProviderRuntimeCredentialService';

const requestPlan = createTestRequestPlan({
  providerId: 'openai',
  adapterId: 'openai-responses',
  catalogRevision: 'test-catalog',
  routeRevision: 'test-route',
  selectedModelId: 'gpt-5.4',
  effectiveModelId: 'gpt-5.4',
  appliedBindingIds: [],
  route: { protocol: 'OpenAIResponses', baseUrl: 'https://api.openai.com/v1', source: 'catalog' },
  headers: {},
  bodyPatch: {},
  contextBudgetTokens: 128_000,
  contextMode: 'normal',
  contextWindowTokens: 128_000,
  activeTierId: 'normal',
  fastMode: false,
  reasoningWire: {
    selection: 'off',
    control: {
      kind: 'none',
      supportsOff: true,
      levels: [],
      defaultSelection: 'off',
      wireProfile: { kind: 'none' },
    },
  },
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ConfiguredRuntimeProvider credential operation', () => {
  it('requires a chat lease and rejects an embed lease', async () => {
    const get = vi.spyOn(providerRuntimeCredentialService, 'get').mockImplementation(
      (_handle, _providerId, expectedOperation) => {
        if (expectedOperation !== 'chat') {
          throw new Error(`Runtime credential handle is not issued for ${expectedOperation}.`);
        }
        throw new Error('Runtime credential handle is not issued for chat.');
      },
    );

    const stream = configuredRuntimeProvider.stream(
      encodeAgentModel('openai', 'gpt-5.4', { contextWindow: 128_000, maxOutputTokens: 4096 }),
      { messages: [], systemPrompt: '' },
      {
        requestPlan,
        credentialHandle: 'embed-lease',
      },
    );

    await expect(stream.result()).rejects.toThrow('not issued for chat');
    expect(get).toHaveBeenCalledWith('embed-lease', 'openai', 'chat');
  });
});

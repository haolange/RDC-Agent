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
import { providerRuntimeCredentialService } from '../../settings/provider-auth/ProviderRuntimeCredentialService';

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
  vi.unstubAllGlobals();
});

describe('ConfiguredRuntimeProvider credential operation', () => {
  it('fails closed when an Azure route lacks its API key', async () => {
    vi.spyOn(providerRuntimeCredentialService, 'get').mockReturnValue({
      handle: 'azure-lease', providerId: 'azure', operation: 'chat', createdAt: 0,
      provider: { id: 'azure', label: 'Azure', protocol: 'AzureOpenAIChatCompletions',
        authMode: 'api-key', enabled: true, apiKey: '' }, connectionValues: {}, connectionHeaders: {},
    });
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const azurePlan = createTestRequestPlan({ ...requestPlan, providerId: 'azure', adapterId: 'azure-openai-chat',
      selectedModelId: 'azure-model', effectiveModelId: 'azure-model',
      route: { protocol: 'AzureOpenAIChatCompletions', baseUrl: 'https://example.test/v1', source: 'catalog' } });
    await expect(configuredRuntimeProvider.stream(
      encodeAgentModel('azure', 'azure-model', { contextWindow: 128_000, maxOutputTokens: 4096 }),
      { messages: [], systemPrompt: '' }, { requestPlan: azurePlan, credentialHandle: 'azure-lease' },
    ).result()).rejects.toThrow(/missing apiKey/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['openai-compatible', 'OpenAICompatibleChatCompletions', [
      { choices: [{ index: 0, delta: { content: 'Local response' }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    ]],
    ['openai-responses', 'OpenAIResponses', [
      { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'm1' } },
      { type: 'response.output_text.delta', output_index: 0, item_id: 'm1', delta: 'Local response' },
      { type: 'response.completed', response: { id: 'r1', status: 'completed' } },
    ]],
  ] as const)('allows a configured local runtime without a key for %s', async (adapterId, protocol, events) => {
    vi.spyOn(providerRuntimeCredentialService, 'get').mockReturnValue({
      handle: 'local-lease', providerId: 'lm-studio', operation: 'chat', createdAt: 0,
      provider: { id: 'lm-studio', label: 'LM Studio', protocol, authMode: 'local', enabled: true, apiKey: '' },
      connectionValues: {}, connectionHeaders: {},
    });
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      expect(new Headers(init.headers).has('Authorization')).toBe(false);
      return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
        headers: { 'Content-Type': 'text/event-stream' },
      });
    });
    vi.stubGlobal('fetch', fetch);
    const localPlan = createTestRequestPlan({
      ...requestPlan, providerId: 'lm-studio', adapterId,
      selectedModelId: 'local-model', effectiveModelId: 'local-model',
      route: { protocol, baseUrl: 'http://127.0.0.1:1234/v1', source: 'catalog' },
    });
    const message = await configuredRuntimeProvider.stream(
      encodeAgentModel('lm-studio', 'local-model', { contextWindow: 128_000, maxOutputTokens: 4096 }),
      { messages: [], systemPrompt: '' },
      { requestPlan: localPlan, credentialHandle: 'local-lease' },
    ).result();
    expect(message.content).toContainEqual(expect.objectContaining({ type: 'text', text: 'Local response' }));
    expect(fetch).toHaveBeenCalledOnce();
  });

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

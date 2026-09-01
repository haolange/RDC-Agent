import { describe, expect, it, vi } from 'vitest';
import { ProviderRuntimeCredentialService } from './ProviderRuntimeCredentialService';

describe('ProviderRuntimeCredentialService', () => {
  it('freezes a credential snapshot behind an opaque, releasable handle', async () => {
    const service = new ProviderRuntimeCredentialService({
      getProvider: () => ({
        id: 'openai',
        protocol: 'OpenAIResponses',
        label: 'OpenAI',
        enabled: true,
        apiKey: 'secret-a',
      }),
      getConnectionValues: () => ({ tenant: 'a' }),
      getConnectionHeaders: (_providerId, values) => ({ 'x-tenant': values.tenant }),
      resolveGoogleVertex: vi.fn(),
      resolveAwsBedrock: vi.fn(),
      now: () => 10,
      createHandle: () => 'handle-1',
    });
    const handle = await service.freeze('openai');
    expect(handle).toBe('handle-1');
    expect(service.get(handle, 'openai', 'chat')).toMatchObject({
      provider: { apiKey: 'secret-a' },
      connectionValues: { tenant: 'a' },
      connectionHeaders: { 'x-tenant': 'a' },
      operation: 'chat',
    });
    service.release(handle);
    expect(() => service.get(handle, 'openai', 'chat')).toThrow('invalid');
  });

  it('rejects mismatched lease operations in both directions', async () => {
    const service = new ProviderRuntimeCredentialService({
      getProvider: () => ({
        id: 'openai',
        protocol: 'OpenAIResponses',
        label: 'OpenAI',
        enabled: true,
        apiKey: 'secret-embed',
      }),
      getConnectionValues: () => ({}),
      getConnectionHeaders: () => ({}),
      resolveGoogleVertex: vi.fn(),
      resolveAwsBedrock: vi.fn(),
      now: () => 10,
      createHandle: () => 'handle-embed',
    });
    const embedHandle = await service.freeze('openai', 'embed');
    expect(service.get(embedHandle, 'openai', 'embed')?.operation).toBe('embed');
    expect(() => service.get(embedHandle, 'openai', 'chat')).toThrow('not issued for chat');

    const chatService = new ProviderRuntimeCredentialService({
      getProvider: () => ({
        id: 'openai',
        protocol: 'OpenAIResponses',
        label: 'OpenAI',
        enabled: true,
        apiKey: 'secret-chat',
      }),
      getConnectionValues: () => ({}),
      getConnectionHeaders: () => ({}),
      resolveGoogleVertex: vi.fn(),
      resolveAwsBedrock: vi.fn(),
      now: () => 10,
      createHandle: () => 'handle-chat',
    });
    const chatHandle = await chatService.freeze('openai', 'chat');
    expect(chatService.get(chatHandle, 'openai', 'chat')?.operation).toBe('chat');
    expect(() => chatService.get(chatHandle, 'openai', 'embed')).toThrow('not issued for embed');
  });

  it('resolves cloud credentials once during the freeze barrier', async () => {
    const resolveGoogleVertex = vi.fn(async () => 'frozen-access-token');
    const service = new ProviderRuntimeCredentialService({
      getProvider: () => ({
        id: 'google-vertex',
        protocol: 'GoogleVertexGemini',
        label: 'Vertex',
        enabled: true,
        apiKey: '',
      }),
      getConnectionValues: () => ({ GOOGLE_APPLICATION_CREDENTIALS: 'adc.json' }),
      getConnectionHeaders: () => ({}),
      resolveGoogleVertex,
      resolveAwsBedrock: vi.fn(),
      now: () => 10,
      createHandle: () => 'handle-vertex',
    });
    const handle = await service.freeze('google-vertex');
    expect(resolveGoogleVertex).toHaveBeenCalledWith('adc.json');
    expect(service.get(handle, 'google-vertex', 'chat')?.provider.apiKey).toBe('frozen-access-token');
  });

  it('refreshes only credential material behind the same handle and preserves the frozen route', async () => {
    let apiKey = 'token-a';
    let baseUrl = 'https://frozen.example/v1';
    const service = new ProviderRuntimeCredentialService({
      getProvider: () => ({
        id: 'chatgpt-account',
        protocol: 'OpenAIResponses',
        authMode: 'account',
        label: 'ChatGPT',
        enabled: true,
        apiKey,
        baseUrl,
      }),
      getConnectionValues: () => ({}),
      getConnectionHeaders: () => ({}),
      resolveGoogleVertex: vi.fn(),
      resolveAwsBedrock: vi.fn(),
      now: () => 10,
      createHandle: () => 'handle-account',
    });
    const handle = await service.freeze('chatgpt-account');
    apiKey = 'token-b';
    baseUrl = 'https://changed.example/v1';
    await service.refresh(handle, 'chatgpt-account');

    expect(service.get(handle, 'chatgpt-account', 'chat')?.provider).toMatchObject({
      apiKey: 'token-b',
      baseUrl: 'https://frozen.example/v1',
    });
  });
});

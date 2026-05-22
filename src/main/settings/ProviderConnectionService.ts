import { getBuiltinProviderDefinition, isBuiltinProviderId } from '@shared/constants/llm';
import type {
  LlmProviderAccountLoginFinishRequest,
  LlmProviderAccountStatus,
  LlmProviderConnectionResult,
  LlmProviderDraftRequest,
  LlmProviderEntry,
  LlmProviderId,
  LlmProviderModel,
  LlmProviderModelDiscoveryStrategy,
} from '@shared/types/settings';
import { settingsService } from '../settings/SettingsService';
import { providerAccountAuthService } from './ProviderAccountAuthService';

const REQUEST_TIMEOUT_MS = 20000;

export function normalizeDiscoveredModels(
  values: unknown[],
  filterModelId: (modelId: string) => boolean = () => true,
): LlmProviderModel[] {
  const models = new Map<string, LlmProviderModel>();
  for (const value of values) {
    const id = typeof value === 'string'
      ? value.trim()
      : value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string'
        ? (value as { id: string }).id.trim()
        : value && typeof value === 'object' && typeof (value as { name?: unknown }).name === 'string'
          ? (value as { name: string }).name.trim()
          : '';
    if (!id || isDeprecatedModel(id) || !filterModelId(id) || models.has(id)) {
      continue;
    }
    const label = value && typeof value === 'object' && typeof (value as { display_name?: unknown }).display_name === 'string'
      ? ((value as { display_name: string }).display_name.trim() || id)
      : id;
    models.set(id, {
      id,
      label,
      enabled: true,
    });
  }
  return Array.from(models.values()).sort((left, right) => left.id.localeCompare(right.id));
}

export function parseProviderError(error: unknown): string {
  if (error instanceof ProviderConnectionError) {
    return error.message;
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return '连接测试超时，请稍后重试';
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return '连接测试失败';
}

class ProviderConnectionError extends Error {}

const isDeprecatedModel = (modelId: string): boolean => {
  const normalized = modelId.toLowerCase();
  return (
    normalized.includes('deprecated')
    || normalized.startsWith('gpt-3.5')
    || normalized.startsWith('claude-2')
    || normalized.startsWith('claude-instant')
  );
};

const isAgentRoutableOpenAiModel = (modelId: string): boolean => {
  const normalized = modelId.toLowerCase();
  return !(
    normalized.includes('embedding')
    || normalized.includes('moderation')
    || normalized.includes('rerank')
    || normalized.includes('whisper')
    || normalized.includes('tts')
    || normalized.includes('dall-e')
    || normalized.includes('image')
    || normalized.includes('audio')
    || normalized.includes('realtime')
    || normalized.includes('transcribe')
    || normalized.includes('computer-use')
  );
};

const requireModels = (models: LlmProviderModel[]): LlmProviderModel[] => {
  if (models.length === 0) {
    throw new ProviderConnectionError('Provider 暂未返回可用于 Agent 路由的模型');
  }
  return models;
};

const toStaticModels = (modelIds: string[]): LlmProviderModel[] => requireModels(
  normalizeDiscoveredModels(modelIds),
);

const getJson = async (url: string, init: RequestInit): Promise<unknown> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new ProviderConnectionError(formatHttpError(response.status));
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
};

const formatHttpError = (status: number): string => {
  if (status === 401 || status === 403) {
    return 'API Key 无效或权限不足';
  }
  if (status === 404) {
    return '模型发现端点不可用';
  }
  if (status >= 500) {
    return 'Provider 服务暂时不可用';
  }
  return `连接测试失败（HTTP ${status}）`;
};

const appendPath = (baseUrl: string, path: string): string =>
  `${baseUrl.trim().replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;

const appendQueryParam = (url: string, key: string, value: string): string => {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
};

const parseModelsPayload = (strategy: LlmProviderModelDiscoveryStrategy, payload: unknown): LlmProviderModel[] => {
  if (!payload || typeof payload !== 'object') {
    return [];
  }
  const record = payload as {
    data?: unknown;
    models?: unknown;
  };
  if (strategy === 'ollama-tags') {
    return Array.isArray(record.models) ? normalizeDiscoveredModels(record.models) : [];
  }
  if (strategy === 'google-ai-studio') {
    const googleModels = Array.isArray(record.models) ? record.models : [];
    return normalizeDiscoveredModels(
      googleModels
        .filter((value) => {
          const methods = value && typeof value === 'object'
            ? (value as { supportedGenerationMethods?: unknown }).supportedGenerationMethods
            : null;
          return !Array.isArray(methods) || methods.includes('generateContent');
        })
        .map((value) => {
          if (value && typeof value === 'object' && typeof (value as { name?: unknown }).name === 'string') {
            return {
              ...(value as Record<string, unknown>),
              id: (value as { name: string }).name.replace(/^models\//, ''),
            };
          }
          return value;
        }),
      isAgentRoutableOpenAiModel,
    );
  }
  return Array.isArray(record.data)
    ? normalizeDiscoveredModels(record.data, isAgentRoutableOpenAiModel)
    : [];
};

const createTinyAnthropicProbeBody = (modelId: string): string => JSON.stringify({
  model: modelId,
  max_tokens: 1,
  messages: [{ role: 'user', content: 'ping' }],
});

const createTinyOpenAiProbeBody = (modelId: string): string => JSON.stringify({
  model: modelId,
  max_tokens: 1,
  messages: [{ role: 'user', content: 'ping' }],
});

export class ProviderConnectionService {
  async testProviderDraft(request: LlmProviderDraftRequest): Promise<LlmProviderConnectionResult> {
    try {
      const provider = this.getProvider(request.providerId);
      const models = await this.discoverModels(
        provider,
        request.apiKey?.trim() ?? '',
        request.baseUrl?.trim() ?? '',
      );
      return {
        success: true,
        provider,
        models,
      };
    } catch (error) {
      return {
        success: false,
        models: [],
        error: parseProviderError(error),
      };
    }
  }

  async connectProvider(request: LlmProviderDraftRequest): Promise<LlmProviderConnectionResult> {
    try {
      const provider = this.getProvider(request.providerId);
      const apiKey = request.apiKey?.trim() ?? '';
      const baseUrl = request.baseUrl?.trim() ?? '';
      const models = await this.discoverModels(provider, apiKey, baseUrl);
      const nextSettings = settingsService.saveProviderConnection(provider.id, apiKey, models, baseUrl);
      const nextProvider = nextSettings.llm.providers.find((entry) => entry.id === provider.id);
      return {
        success: true,
        provider: nextProvider,
        models,
      };
    } catch (error) {
      return {
        success: false,
        models: [],
        error: parseProviderError(error),
      };
    }
  }

  async refreshProviderModels(providerId: LlmProviderId): Promise<LlmProviderConnectionResult> {
    try {
      const provider = this.getProvider(providerId);
      if (provider.authMode === 'account') {
        const status = await providerAccountAuthService.test(provider.id);
        if (!status.connected) {
          throw new ProviderConnectionError(status.error || status.message || 'Account provider is not connected');
        }
        const nextProvider = settingsService.getAll().llm.providers.find((entry) => entry.id === provider.id);
        return {
          success: true,
          provider: nextProvider,
          models: nextProvider?.models ?? [],
        };
      }
      const models = await this.discoverModels(provider, '', '');
      const nextSettings = settingsService.saveProviderConnection(provider.id, '', models, '');
      const nextProvider = nextSettings.llm.providers.find((entry) => entry.id === provider.id);
      return {
        success: true,
        provider: nextProvider,
        models,
      };
    } catch (error) {
      return {
        success: false,
        models: [],
        error: parseProviderError(error),
      };
    }
  }

  disconnectProvider(providerId: LlmProviderId): LlmProviderConnectionResult {
    try {
      const nextSettings = settingsService.disconnectProvider(providerId);
      const provider = nextSettings.llm.providers.find((entry) => entry.id === providerId);
      return {
        success: true,
        provider,
        models: [],
      };
    } catch (error) {
      return {
        success: false,
        models: [],
        error: parseProviderError(error),
      };
    }
  }

  startProviderAccountLogin(providerId: LlmProviderId): Promise<LlmProviderAccountStatus> {
    return providerAccountAuthService.startLogin(providerId);
  }

  finishProviderAccountLogin(request: LlmProviderAccountLoginFinishRequest): Promise<LlmProviderAccountStatus> {
    return providerAccountAuthService.finishLogin(request);
  }

  getProviderAccountStatus(providerId: LlmProviderId): LlmProviderAccountStatus {
    return providerAccountAuthService.status(providerId);
  }

  logoutProviderAccount(providerId: LlmProviderId): LlmProviderAccountStatus {
    return providerAccountAuthService.logout(providerId);
  }

  private getProvider(providerId: LlmProviderId): LlmProviderEntry {
    const provider = settingsService.getAll().llm.providers.find((entry) => entry.id === providerId);
    if (!provider || !isBuiltinProviderId(provider.id)) {
      throw new ProviderConnectionError('未知 Provider');
    }
    return provider;
  }

  private async discoverModels(provider: LlmProviderEntry, apiKeyDraft: string, baseUrlDraft: string): Promise<LlmProviderModel[]> {
    if (provider.authMode === 'account') {
      throw new ProviderConnectionError('Account providers must be tested through the account login flow.');
    }
    const definition = getBuiltinProviderDefinition(provider.id);
    if (!definition?.modelDiscovery) {
      throw new ProviderConnectionError('Provider 缺少模型发现配置');
    }
    const apiKey = provider.authMode === 'api-key'
      ? apiKeyDraft || settingsService.getProviderSecret(provider.id)
      : '';
    if (provider.authMode === 'api-key' && !apiKey) {
      throw new ProviderConnectionError('请输入 API Key');
    }

    const strategy = definition.modelDiscovery;
    if (strategy === 'static') {
      return toStaticModels(definition.recommendedModels);
    }
    const baseUrl = (baseUrlDraft || provider.baseUrl || definition.baseUrl || '').trim().replace(/\/+$/, '');
    if (!baseUrl) {
      throw new ProviderConnectionError('请填写 Provider Base URL');
    }
    if (strategy === 'anthropic-candidate-validation') {
      return this.validateAnthropicCandidateModels(provider, apiKey, baseUrl, definition.recommendedModels);
    }
    if (strategy === 'azure-openai') {
      return this.validateAzureCandidateModels(apiKey, baseUrl, definition.recommendedModels);
    }
    if (strategy === 'google-ai-studio') {
      const payload = await getJson(appendQueryParam(appendPath(baseUrl, '/models'), 'key', apiKey), {
        method: 'GET',
      });
      return requireModels(parseModelsPayload(strategy, payload));
    }
    const url = strategy === 'ollama-tags'
      ? appendPath(new URL(baseUrl).origin, '/api/tags')
      : appendPath(baseUrl, '/models');
    const headers = this.createHeaders(provider, apiKey);
    const payload = await getJson(url, {
      method: 'GET',
      headers,
    });
    return requireModels(parseModelsPayload(strategy, payload));
  }

  private async validateAnthropicCandidateModels(
    provider: LlmProviderEntry,
    apiKey: string,
    baseUrl: string,
    modelIds: string[],
  ): Promise<LlmProviderModel[]> {
    const validModels: string[] = [];
    const url = appendPath(baseUrl, '/messages');
    const headers = this.createHeaders(provider, apiKey);
    for (const modelId of modelIds) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            ...headers,
            'Content-Type': 'application/json',
          },
          signal: controller.signal,
          body: createTinyAnthropicProbeBody(modelId),
        });
        clearTimeout(timeout);
        if (response.ok) {
          validModels.push(modelId);
        }
      } catch {
        // Continue probing the remaining candidates.
      }
    }
    return toStaticModels(validModels);
  }

  private async validateAzureCandidateModels(apiKey: string, baseUrl: string, modelIds: string[]): Promise<LlmProviderModel[]> {
    const validModels: string[] = [];
    const chatUrl = appendQueryParam(
      baseUrl.endsWith('/chat/completions') ? baseUrl : appendPath(baseUrl, '/chat/completions'),
      'api-version',
      '2024-10-21',
    );
    for (const modelId of modelIds) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        const response = await fetch(chatUrl, {
          method: 'POST',
          headers: {
            'api-key': apiKey,
            'Content-Type': 'application/json',
          },
          signal: controller.signal,
          body: createTinyOpenAiProbeBody(modelId),
        });
        clearTimeout(timeout);
        if (response.ok) {
          validModels.push(modelId);
        }
      } catch {
        // Continue probing the remaining candidates.
      }
    }
    return toStaticModels(validModels);
  }

  private createHeaders(provider: LlmProviderEntry, apiKey: string): HeadersInit {
    if (provider.authMode === 'local') {
      return {};
    }
    if (provider.kind === 'anthropic') {
      return {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      };
    }
    return {
      Authorization: `Bearer ${apiKey}`,
    };
  }
}

export const providerConnectionService = new ProviderConnectionService();

import { getBuiltinProviderDefinition, isBuiltinProviderId } from '@shared/constants/llm';
import type {
  LlmProviderAccountStatus,
  LlmProviderConnectionResult,
  LlmProviderDraftRequest,
  LlmProviderEntry,
  LlmProviderId,
  LlmProviderModel,
  LlmProviderModelDiscoveryStrategy,
} from '@shared/types/settings';
import { settingsService } from '../settings/SettingsService';

const REQUEST_TIMEOUT_MS = 20000;

export function normalizeDiscoveredModels(values: unknown[]): LlmProviderModel[] {
  const models = new Map<string, LlmProviderModel>();
  for (const value of values) {
    const id = typeof value === 'string'
      ? value.trim()
      : value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string'
        ? (value as { id: string }).id.trim()
        : value && typeof value === 'object' && typeof (value as { name?: unknown }).name === 'string'
          ? (value as { name: string }).name.trim()
          : '';
    if (!id || isDeprecatedModel(id) || models.has(id)) {
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

const requireModels = (models: LlmProviderModel[]): LlmProviderModel[] => {
  if (models.length === 0) {
    throw new ProviderConnectionError('该 Provider 暂未返回可用模型');
  }
  return models;
};

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
  return Array.isArray(record.data) ? normalizeDiscoveredModels(record.data) : [];
};

export class ProviderConnectionService {
  async testProviderDraft(request: LlmProviderDraftRequest): Promise<LlmProviderConnectionResult> {
    try {
      const provider = this.getProvider(request.providerId);
      const models = await this.discoverModels(provider, request.apiKey?.trim() ?? '');
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
      const models = await this.discoverModels(provider, apiKey);
      const nextSettings = settingsService.saveProviderConnection(provider.id, apiKey, models);
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
      const models = await this.discoverModels(provider, '');
      const nextSettings = settingsService.saveProviderConnection(provider.id, '', models);
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

  startProviderAccountLogin(providerId: LlmProviderId): LlmProviderAccountStatus {
    return this.getProviderAccountStatus(providerId);
  }

  getProviderAccountStatus(providerId: LlmProviderId): LlmProviderAccountStatus {
    const definition = isBuiltinProviderId(providerId) ? getBuiltinProviderDefinition(providerId) : null;
    const isAccountProvider = definition?.authMode === 'account';
    return {
      providerId,
      available: Boolean(isAccountProvider && definition?.accountLoginConfigured),
      connected: false,
      message: isAccountProvider ? (definition?.unavailableReason ?? '当前版本未配置登录通道') : undefined,
      error: isAccountProvider ? undefined : 'Provider 不支持账号登录',
    };
  }

  logoutProviderAccount(providerId: LlmProviderId): LlmProviderAccountStatus {
    return this.getProviderAccountStatus(providerId);
  }

  private getProvider(providerId: LlmProviderId): LlmProviderEntry {
    const provider = settingsService.getAll().llm.providers.find((entry) => entry.id === providerId);
    if (!provider || !isBuiltinProviderId(provider.id)) {
      throw new ProviderConnectionError('未知 Provider');
    }
    return provider;
  }

  private async discoverModels(provider: LlmProviderEntry, apiKeyDraft: string): Promise<LlmProviderModel[]> {
    if (provider.authMode === 'account') {
      throw new ProviderConnectionError(provider.unavailableReason || '当前版本未配置登录通道');
    }
    const definition = getBuiltinProviderDefinition(provider.id);
    if (!definition?.baseUrl || !definition.modelDiscovery) {
      throw new ProviderConnectionError('Provider 缺少模型发现配置');
    }
    const apiKey = provider.authMode === 'api-key'
      ? apiKeyDraft || settingsService.getProviderSecret(provider.id)
      : '';
    if (provider.authMode === 'api-key' && !apiKey) {
      throw new ProviderConnectionError('请输入 API Key');
    }

    const strategy = definition.modelDiscovery;
    const url = strategy === 'ollama-tags'
      ? appendPath(new URL(definition.baseUrl).origin, '/api/tags')
      : appendPath(definition.baseUrl, '/models');
    const headers = this.createHeaders(provider, apiKey);
    const payload = await getJson(url, {
      method: 'GET',
      headers,
    });
    return requireModels(parseModelsPayload(strategy, payload));
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

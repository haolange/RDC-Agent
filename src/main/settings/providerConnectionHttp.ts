import type { DiscoveryStrategy } from '@shared/types/providerCapability';
import type { LlmProviderModel } from '@shared/types/settings';
import { isAdmittedDiscoveredModel } from './DiscoveryAdmission';
import { ProviderConnectionError } from './providerConnectionErrors';
import { normalizeDiscoveredModels } from './providerConnectionModelUtils';

export const REQUEST_TIMEOUT_MS = 20000;

const isAgentRoutableOpenAiModel = (modelId: string): boolean => isAdmittedDiscoveredModel(modelId);

export const getJson = async (url: string, init: RequestInit): Promise<unknown> => {
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

export const appendPath = (baseUrl: string, path: string): string =>
  `${baseUrl.trim().replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;

export const appendQueryParam = (url: string, key: string, value: string): string => {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
};

export const parseModelsPayload = (strategy: DiscoveryStrategy | string, payload: unknown): LlmProviderModel[] => {
  if (!payload || typeof payload !== 'object') {
    return [];
  }
  const record = payload as {
    data?: unknown;
    models?: unknown;
  };
  const strategyKey = !strategy
    ? 'openai-compatible'
    : typeof strategy === 'string'
      ? strategy
      : strategy.kind === 'custom-parser'
        ? strategy.parserId
        : 'openai-compatible';
  if (strategyKey === 'ollama-tags') {
    return Array.isArray(record.models) ? normalizeDiscoveredModels(record.models) : [];
  }
  if (strategyKey === 'google-ai-studio') {
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

export const createTinyAnthropicProbeBody = (modelId: string): string => JSON.stringify({
  model: modelId,
  max_tokens: 1,
  messages: [{ role: 'user', content: 'ping' }],
});

export const createTinyOpenAiProbeBody = (modelId: string): string => JSON.stringify({
  model: modelId,
  max_tokens: 1,
  messages: [{ role: 'user', content: 'ping' }],
});

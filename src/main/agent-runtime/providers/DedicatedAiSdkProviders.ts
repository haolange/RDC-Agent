import type { LlmProviderProtocol } from '@shared/types/settings';
import type { JSONObject } from '@ai-sdk/provider';
import type { ProviderStrategy } from '../core/ProviderRegistry';
import type { StreamOptions } from '../core/types';
import {
  assertSapAiCoreApiUrl,
  createSapAiCoreDestination,
  parseSapAiCoreServiceKey,
} from '../../settings/SapAiCoreCredentials';
import { AiSdkStreamingProvider } from './AiSdkStreamingProvider';

interface DedicatedProviderConfig {
  apiKey: string;
  baseUrl?: string;
  connectionValues?: Readonly<Record<string, string>>;
}

export function createGitLabDuoProvider(config: DedicatedProviderConfig): ProviderStrategy {
  return new AiSdkStreamingProvider({
    api: 'gitlab-duo',
    createModel: async (model) => {
      const { createGitLab, VERSION } = await import('gitlab-ai-provider');
      const provider = createGitLab({
        instanceUrl: requireBaseUrl(config.baseUrl, 'GitLab instance URL'),
        apiKey: requireSecret(config.apiKey, 'GitLab token'),
        aiGatewayHeaders: {
          'User-Agent': `RDC-Agent/1.0 gitlab-ai-provider/${VERSION}`,
          'anthropic-beta': 'context-1m-2025-08-07',
        },
        featureFlags: {
          duo_agent_platform_agentic_chat: true,
          duo_agent_platform: true,
        },
      });
      return provider.agenticChat(model.id);
    },
  });
}

export function createSapAiCoreProvider(
  config: DedicatedProviderConfig,
  protocol: Extract<LlmProviderProtocol, 'SapAiCoreOrchestration' | 'SapAiCoreFoundationModels'>,
): ProviderStrategy {
  const api = protocol === 'SapAiCoreFoundationModels' ? 'foundation-models' : 'orchestration';
  return new AiSdkStreamingProvider({
    api: `sap-ai-core-${api}`,
    createModel: async (model) => {
      const { createSAPAIProvider } = await import('@jerome-benoit/sap-ai-provider-v2');
      const serviceKey = parseSapAiCoreServiceKey(requireSecret(config.apiKey, 'AICORE_SERVICE_KEY'));
      assertSapAiCoreApiUrl(serviceKey, requireBaseUrl(config.baseUrl, 'AICORE_AI_API_URL'));
      const provider = createSAPAIProvider({
        api,
        destination: createSapAiCoreDestination(serviceKey),
        deploymentId: optional(config.connectionValues?.AICORE_DEPLOYMENT_ID),
        resourceGroup: optional(config.connectionValues?.AICORE_RESOURCE_GROUP),
        warnOnAmbiguousConfig: false,
        defaultSettings: {
          api,
          includeReasoning: true,
        },
      });
      return provider(model.id);
    },
    providerOptions: (options) => ({
      'sap-ai': {
        api,
        includeReasoning: options.reasoningVisibility !== 'none',
        modelParams: toSapModelParams(options),
      },
    }),
  });
}

function toSapModelParams(options: StreamOptions): JSONObject {
  const patch: JSONObject = { ...options.requestPlan.bodyPatch };
  delete patch.model;
  delete patch.stream;
  return patch;
}

function requireSecret(value: string | undefined, label: string): string {
  const normalized = value?.trim() ?? '';
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function requireBaseUrl(value: string | undefined, label: string): string {
  const normalized = value?.trim().replace(/\/+$/u, '') ?? '';
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function optional(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

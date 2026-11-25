import type { LlmAgentRoute, LlmProviderAuthMode, LlmProviderId, LlmProviderProtocol } from './settings';

/** Runtime credentials and transport metadata. Model capability never lives here. */
export interface LLMProviderConfig {
  id: LlmProviderId;
  protocol: LlmProviderProtocol;
  authMode?: LlmProviderAuthMode;
  label: string;
  enabled: boolean;
  apiKey: string;
  baseUrl?: string;
  accountId?: string;
  docsUrl?: string;
}

export type LLMAgentRouteConfig = LlmAgentRoute;

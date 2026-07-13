import type { AgentRole } from './agent';
import type { LlmProviderAuthMode, LlmProviderId, LlmProviderProtocol } from './settings';

/** Provider-neutral tool call projection used by shared runtime events. */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LLMToolCallDelta {
  id: string;
  name?: string;
  argumentsText?: string;
}

/** Legacy-free stream event contract shared with renderer projections. */
export type LLMStreamEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'tool-call-delta'; toolCall: LLMToolCallDelta }
  | { type: 'done' }
  | { type: 'error'; error: string };

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

export interface LLMAgentRouteConfig {
  agentId: AgentRole;
  providerId: LlmProviderId;
  modelId: string;
}

/** Runtime provider credentials plus user-selected agent routes. */
export interface LLMConfig {
  providers: LLMProviderConfig[];
  agentRoutes: LLMAgentRouteConfig[];
}

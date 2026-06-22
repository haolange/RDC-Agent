import type {
  LlmProviderAccountStatus,
  LlmProviderCatalogResponse,
  LlmProviderModel,
  LlmProviderProtocol,
} from '@shared/types/settings';

export type SettingsSection = 'general' | 'workspace' | 'models' | 'skillsAgents' | 'tools';

export type ProviderConnectionBusyState = 'idle' | 'testing' | 'saving';

export interface ProviderConnectionDraft {
  providerId: string;
  protocol: ProviderProtocol;
  apiKey: string;
  baseUrl: string;
  showApiKey: boolean;
  usingStoredSecret: boolean;
  busy: ProviderConnectionBusyState;
  error: string;
  testedApiKey: string;
  testedBaseUrl: string;
  testedProtocol: ProviderProtocol;
  models: LlmProviderModel[];
  accountStatus?: LlmProviderAccountStatus;
  authCode: string;
}

export type ProviderProtocol = LlmProviderProtocol;
export type ProviderCatalogCategory = LlmProviderCatalogResponse['categories'][number];
export type ProviderCatalogSnapshot = LlmProviderCatalogResponse;
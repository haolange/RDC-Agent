import type {
  LlmProviderAccountLoginMode,
  LlmProviderAccountStatus,
  LlmProviderCatalogResponse,
  LlmProviderConnectionResult,
  LlmProviderModel,
  LlmProviderProtocol,
} from '@shared/types/settings';

export type SettingsSection = 'general' | 'workspace' | 'models' | 'skills' | 'agents' | 'tools' | 'hooks';

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
  discoveryDiagnostic: LlmProviderConnectionResult['discoveryDiagnostic'] | null;
  testedApiKey: string;
  testedBaseUrl: string;
  testedProtocol: ProviderProtocol;
  models: LlmProviderModel[];
  accountStatus?: LlmProviderAccountStatus;
  accountLoginMode: LlmProviderAccountLoginMode;
  authCode: string;
  oauthClientId: string;
}

export type ProviderProtocol = LlmProviderProtocol;
export type ProviderCatalogCategory = LlmProviderCatalogResponse['categories'][number];
export type ProviderCatalogSnapshot = LlmProviderCatalogResponse;

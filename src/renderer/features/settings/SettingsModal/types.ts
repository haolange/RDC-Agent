import type {
  LlmProviderAccountLoginMode,
  LlmProviderAccountStatus,
  LlmProviderAuthMode,
  LlmProviderCatalogResponse,
  LlmProviderConnectionResult,
  LlmProviderModel,
  LlmProviderProtocol,
} from '@shared/types/settings';

export type SettingsSection = 'general' | 'workspace' | 'models' | 'skills' | 'agents' | 'tools' | 'hooks' | 'diagnostics';

export type ProviderConnectionBusyState = 'idle' | 'testing' | 'saving';

export interface ProviderConnectionDraft {
  providerId: string;
  authMode: LlmProviderAuthMode;
  protocol: ProviderProtocol;
  /** Transient typed connection fields. Secret values never enter persisted renderer settings. */
  connectionValues: Record<string, string>;
  /** Secret fields that should continue using their main-process secret reference. */
  usingStoredConnectionSecrets: Record<string, boolean>;
  /** Per-field visibility state for transient secret inputs. */
  visibleConnectionSecrets: Record<string, boolean>;
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
  testedAuthMode: LlmProviderAuthMode;
  testedConnectionSignature: string;
  models: LlmProviderModel[];
  accountStatus?: LlmProviderAccountStatus;
  accountLoginMode: LlmProviderAccountLoginMode;
  authCode: string;
}

export type ProviderProtocol = LlmProviderProtocol;
export type ProviderCatalogCategory = LlmProviderCatalogResponse['categories'][number];
export type ProviderCatalogSnapshot = LlmProviderCatalogResponse;

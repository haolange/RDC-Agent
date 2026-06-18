import type { LlmProviderAccountStatus, LlmProviderModel } from '@shared/types/settings';

export type SettingsSection = 'general' | 'workspace' | 'models' | 'skillsAgents' | 'tools';

export type ProviderConnectionBusyState = 'idle' | 'testing' | 'saving';

export interface ProviderConnectionDraft {
  providerId: string;
  apiKey: string;
  baseUrl: string;
  showApiKey: boolean;
  usingStoredSecret: boolean;
  busy: ProviderConnectionBusyState;
  error: string;
  testedApiKey: string;
  models: LlmProviderModel[];
  accountStatus?: LlmProviderAccountStatus;
  authCode: string;
}

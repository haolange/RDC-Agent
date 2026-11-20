import type {
  AgentModelSettings,
  AgentPermissionMode,
  AgentPermissionSettings,
  LayoutPreferences,
  ProfileSettings,
  RdcCliInvokerSettings,
  AgentShellSettings,
  CodeInterpreterSettings,
  UiPreferences,
  LlmProviderEntry,
} from '@shared/types/settings';
import {
  DEFAULT_AGENT_RUNTIME,
  DEFAULT_APPEARANCE,
  DEFAULT_LAYOUT,
  DEFAULT_PROFILE,
  DEFAULT_TOOLING,
} from '@shared/constants/appSettingsDefaults';
import {
  LEFT_SIDEBAR_COLLAPSED_WIDTH,
  LEFT_SIDEBAR_DEFAULT_WIDTH,
  LEFT_SIDEBAR_MIN_WIDTH,
  RIGHT_PANEL_COLLAPSED_WIDTH,
  RIGHT_PANEL_DEFAULT_WIDTH,
  RIGHT_PANEL_MIN_WIDTH,
  SIDEBAR_MAX_WIDTH,
} from '@shared/constants/layout';

export const SETTINGS_SCHEMA_VERSION = 8;

export type PersistedLlmProviderEntry = Partial<LlmProviderEntry>;

export interface PersistedSettingsPayload {
  schemaVersion?: number;
  appearance?: Partial<UiPreferences>;
  layout?: Partial<LayoutPreferences>;
  profile?: Partial<ProfileSettings>;
  llm?: {
    providers?: PersistedLlmProviderEntry[];
  };
  tooling?: {
    rdcCli?: Partial<RdcCliInvokerSettings>;
    codeInterpreter?: Partial<CodeInterpreterSettings>;
    shell?: Partial<AgentShellSettings>;
  };
  agentRuntime?: {
    permissions?: Partial<AgentPermissionSettings>;
    context?: Partial<{ compactionThresholdPercent: number }>;
  };
  agentModels?: AgentModelSettings;
}

export const LEFT_DEFAULTS = {
  width: LEFT_SIDEBAR_DEFAULT_WIDTH,
  min: LEFT_SIDEBAR_MIN_WIDTH,
  max: SIDEBAR_MAX_WIDTH,
  collapsedWidth: LEFT_SIDEBAR_COLLAPSED_WIDTH,
};

export const RIGHT_DEFAULTS = {
  width: RIGHT_PANEL_DEFAULT_WIDTH,
  min: RIGHT_PANEL_MIN_WIDTH,
  max: SIDEBAR_MAX_WIDTH,
  collapsedWidth: RIGHT_PANEL_COLLAPSED_WIDTH,
};

export const VALID_PERMISSION_MODES: AgentPermissionMode[] = ['default', 'auto-review', 'full-access', 'custom'];

export function createDefaultPersistedSettings(): PersistedSettingsPayload {
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    appearance: DEFAULT_APPEARANCE,
    layout: DEFAULT_LAYOUT,
    profile: DEFAULT_PROFILE,
    tooling: DEFAULT_TOOLING,
    agentRuntime: DEFAULT_AGENT_RUNTIME,
    agentModels: { default: {}, byAgent: {} },
    llm: {
      providers: [],
    },
  };
}

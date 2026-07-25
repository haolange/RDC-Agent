import type {
  AppRuntimePaths,
  AgentPermissionMode,
  AgentPermissionSettings,
  AgentRuntimeSettings,
  LayoutPreferences,
  ProfileSettings,
  RdxActionId,
  RdxActionSettingsMap,
  RdxCliInvokerSettings,
  RdxShellActionSettings,
  ToolingSettings,
  UiPreferences,
  LlmProviderEntry,
} from '@shared/types/settings';
import { createDefaultUiPreferences } from '@shared/theme/uiPreferences';
import {
  LEFT_SIDEBAR_COLLAPSED_WIDTH,
  LEFT_SIDEBAR_DEFAULT_WIDTH,
  LEFT_SIDEBAR_MAX_WIDTH,
  LEFT_SIDEBAR_MIN_WIDTH,
  RIGHT_PANEL_COLLAPSED_WIDTH,
  RIGHT_PANEL_DEFAULT_WIDTH,
  RIGHT_PANEL_MAX_WIDTH,
  RIGHT_PANEL_MIN_WIDTH,
  TERMINAL_DEFAULT_HEIGHT,
} from '@shared/constants/layout';

export const SETTINGS_SCHEMA_VERSION = 6;

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
    rdxCli?: Partial<RdxCliInvokerSettings>;
    rdxActions?: Partial<Record<RdxActionId, Partial<RdxShellActionSettings>>>;
  };
  agentRuntime?: {
    permissions?: Partial<AgentPermissionSettings>;
  };
}

export const LEFT_DEFAULTS = {
  width: LEFT_SIDEBAR_DEFAULT_WIDTH,
  min: LEFT_SIDEBAR_MIN_WIDTH,
  max: LEFT_SIDEBAR_MAX_WIDTH,
  collapsedWidth: LEFT_SIDEBAR_COLLAPSED_WIDTH,
};

export const RIGHT_DEFAULTS = {
  width: RIGHT_PANEL_DEFAULT_WIDTH,
  min: RIGHT_PANEL_MIN_WIDTH,
  max: RIGHT_PANEL_MAX_WIDTH,
  collapsedWidth: RIGHT_PANEL_COLLAPSED_WIDTH,
};

export const VALID_PERMISSION_MODES: AgentPermissionMode[] = ['default', 'auto-review', 'full-access', 'custom'];

export const EMPTY_PATHS: AppRuntimePaths = {
  userRdxRoot: '',
  settingsPath: '',
  instructionsPath: '',
  agentsPath: '',
  profileStatePath: '',
  logsPath: '',
  logPath: '',
  projectsPath: '',
  knowledgePath: '',
  policiesPath: '',
  skillsPath: '',
  mcpPath: '',
  secretsPath: '',
};

export const DEFAULT_APPEARANCE: UiPreferences = createDefaultUiPreferences();

export const DEFAULT_LAYOUT: LayoutPreferences = {
  leftSidebar: {
    collapsed: false,
    width: LEFT_DEFAULTS.width,
    expandedWidth: LEFT_DEFAULTS.width,
  },
  rightPanel: {
    collapsed: false,
    width: RIGHT_DEFAULTS.width,
    expandedWidth: RIGHT_DEFAULTS.width,
  },
  terminal: {
    height: TERMINAL_DEFAULT_HEIGHT,
  },
};

export const DEFAULT_PROFILE: ProfileSettings = {
  nickname: 'RDC Operator',
  avatarPath: '',
};

export const DEFAULT_RDX_CLI_INVOKER: RdxCliInvokerSettings = {
  enabled: false,
  command: '',
  argsPrefix: [],
  workingDirectory: '',
  env: {},
  timeoutMs: 60000,
  catalogPath: '',
  jsonMode: 'auto',
};

export const createDefaultRdxAction = (): RdxShellActionSettings => ({
  enabled: false,
  command: '',
  args: [],
  workingDirectory: '',
  env: {},
  timeoutMs: 60000,
});

export const DEFAULT_RDX_ACTIONS: RdxActionSettingsMap = {
  openCapture: createDefaultRdxAction(),
  openRemoteCapture: createDefaultRdxAction(),
  connectRemote: createDefaultRdxAction(),
  closeRuntime: createDefaultRdxAction(),
  openPreview: createDefaultRdxAction(),
};

export const DEFAULT_TOOLING: ToolingSettings = {
  rdxCli: DEFAULT_RDX_CLI_INVOKER,
  rdxActions: DEFAULT_RDX_ACTIONS,
};

export const DEFAULT_AGENT_RUNTIME: AgentRuntimeSettings = {
  permissions: {
    mode: 'default',
    readableRoots: [],
    writableRoots: [],
    allowedCommandPrefixes: [],
    deniedCommandPrefixes: [],
  },
};

export function createDefaultPersistedSettings(): PersistedSettingsPayload {
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    appearance: DEFAULT_APPEARANCE,
    layout: DEFAULT_LAYOUT,
    profile: DEFAULT_PROFILE,
    tooling: DEFAULT_TOOLING,
    agentRuntime: DEFAULT_AGENT_RUNTIME,
    llm: {
      providers: [],
    },
  };
}

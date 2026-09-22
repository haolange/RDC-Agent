import type {
  AppRuntimePaths,
  AgentPermissionMode,
  AgentPermissionSettings,
  AgentRuntimeSettings,
  LayoutPreferences,
  ProfileSettings,
  RdcCliInvokerSettings,
  AgentShellSettings,
  CodeInterpreterSettings,
  ToolingSettings,
  UiPreferences,
  LlmProviderEntry,
} from '@shared/types/settings';
import { createDefaultUiPreferences } from '@shared/theme/uiPreferences';
import {
  APP_DEFAULT_WINDOW_HEIGHT,
  APP_DEFAULT_WINDOW_WIDTH,
  LEFT_SIDEBAR_COLLAPSED_WIDTH,
  LEFT_SIDEBAR_DEFAULT_WIDTH,
  LEFT_SIDEBAR_MIN_WIDTH,
  RIGHT_PANEL_COLLAPSED_WIDTH,
  RIGHT_PANEL_DEFAULT_WIDTH,
  RIGHT_PANEL_MIN_WIDTH,
  SIDEBAR_MAX_WIDTH,
  TERMINAL_DEFAULT_HEIGHT,
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

export const EMPTY_PATHS: AppRuntimePaths = {
  userRdcRoot: '',
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
  window: {
    width: APP_DEFAULT_WINDOW_WIDTH,
    height: APP_DEFAULT_WINDOW_HEIGHT,
    x: 0,
    y: 0,
    isMaximized: false,
  },
};

export const DEFAULT_PROFILE: ProfileSettings = {
  nickname: 'RDC Operator',
  avatarPath: '',
};

export const DEFAULT_RDC_CLI_INVOKER: RdcCliInvokerSettings = {
  enabled: false,
  command: '',
  argsPrefix: [],
  workingDirectory: '',
  env: {},
  timeoutMs: 120000,
};

export const DEFAULT_CODE_INTERPRETER: CodeInterpreterSettings = {
  enabled: false,
  command: '',
  argsPrefix: [],
  timeoutMs: 60000,
  env: {},
  artifactsEnabled: true,
};

export const DEFAULT_SHELL_TOOLING: AgentShellSettings = {
  executable: '',
};

export const DEFAULT_TOOLING: ToolingSettings = {
  rdcCli: DEFAULT_RDC_CLI_INVOKER,
  codeInterpreter: DEFAULT_CODE_INTERPRETER,
  shell: DEFAULT_SHELL_TOOLING,
};

export const DEFAULT_AGENT_RUNTIME: AgentRuntimeSettings = {
  permissions: {
    mode: 'default',
    readableRoots: [],
    writableRoots: [],
    allowedCommandPrefixes: [],
    deniedCommandPrefixes: [],
  },
  context: {
    compactionThresholdPercent: 80,
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

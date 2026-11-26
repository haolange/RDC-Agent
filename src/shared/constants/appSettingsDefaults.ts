import { TOP_LEVEL_AGENT_IDS } from '../types/agent';
import { createDefaultUiPreferences } from '../theme/uiPreferences';
import {
  APP_DEFAULT_WINDOW_HEIGHT,
  APP_DEFAULT_WINDOW_WIDTH,
  LEFT_SIDEBAR_DEFAULT_WIDTH,
  RIGHT_PANEL_DEFAULT_WIDTH,
  TERMINAL_DEFAULT_HEIGHT,
} from './layout';
import type {
  AgentRuntimeSettings,
  AgentShellSettings,
  AppRuntimePaths,
  AppSettings,
  CodeInterpreterSettings,
  LayoutPreferences,
  ProfileSettings,
  RdcCliInvokerSettings,
  ToolingSettings,
  UiPreferences,
} from '../types/settings';

/** The one set of settings defaults: main persists and sanitizes against it, the renderer starts from it. */

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
  leftSidebar: { collapsed: false, width: LEFT_SIDEBAR_DEFAULT_WIDTH, expandedWidth: LEFT_SIDEBAR_DEFAULT_WIDTH },
  rightPanel: { collapsed: false, width: RIGHT_PANEL_DEFAULT_WIDTH, expandedWidth: RIGHT_PANEL_DEFAULT_WIDTH },
  terminal: { height: TERMINAL_DEFAULT_HEIGHT },
  window: { width: APP_DEFAULT_WINDOW_WIDTH, height: APP_DEFAULT_WINDOW_HEIGHT, x: 0, y: 0, isMaximized: false },
};

export const DEFAULT_PROFILE: ProfileSettings = {
  nickname: 'RDC Operator',
  avatarPath: '',
};

/**
 * The range the RDC no-progress patience may take (`tooling.rdcCli.noProgressTimeoutMs`): the range every RDC-Tool
 * catalog entry publishes in its `execution_budget`. A turn binding is still checked against its frozen catalog.
 */
export const RDC_NO_PROGRESS_TIMEOUT_RANGE_MS = Object.freeze({ min: 30_000, max: 3_600_000 });

export const DEFAULT_RDC_CLI_INVOKER: RdcCliInvokerSettings = {
  enabled: false,
  command: '',
  argsPrefix: [],
  workingDirectory: '',
  env: {},
  noProgressTimeoutMs: 300_000,
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

/** Settings before main has delivered the stored ones: defaults with no providers, agents or paths. */
export function createDefaultAppSettings(): AppSettings {
  return {
    appearance: createDefaultUiPreferences(),
    layout: DEFAULT_LAYOUT,
    profile: DEFAULT_PROFILE,
    agentModels: { default: {}, byAgent: {} },
    tooling: DEFAULT_TOOLING,
    agentRuntime: DEFAULT_AGENT_RUNTIME,
    llm: {
      providers: [],
      agentRoutes: TOP_LEVEL_AGENT_IDS.map((agentId) => ({ agentId, providerId: '', modelId: '' })),
    },
    agents: { directoryPath: '', definitions: [], globalInstructions: '', diagnostics: [] },
    resourceCatalog: { diagnostics: [] },
    paths: EMPTY_PATHS,
  };
}

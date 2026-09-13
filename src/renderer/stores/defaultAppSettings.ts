import type { AppSettings, LlmAgentRoute } from '@shared/types/settings';
import {
  APP_DEFAULT_WINDOW_HEIGHT,
  APP_DEFAULT_WINDOW_WIDTH,
  LEFT_SIDEBAR_DEFAULT_WIDTH,
  RIGHT_PANEL_DEFAULT_WIDTH,
  TERMINAL_DEFAULT_HEIGHT,
} from '@shared/constants/layout';
import { DEFAULT_MODEL_ROUTING } from '@shared/types/agent';
import { createDefaultUiPreferences } from '@shared/theme/uiPreferences';

const createEmptyAgentRoutes = (): LlmAgentRoute[] =>
  Object.keys(DEFAULT_MODEL_ROUTING).map((agentId) => ({
    agentId: agentId as LlmAgentRoute['agentId'],
    providerId: '',
    modelId: '',
  }));

const createEmptyRdxAction = () => ({
  enabled: false,
  command: '',
  args: [],
  workingDirectory: '',
  env: {},
  timeoutMs: 60000,
});

export const DEFAULT_SETTINGS: AppSettings = {
  appearance: createDefaultUiPreferences(),
  layout: {
    leftSidebar: { collapsed: false, width: LEFT_SIDEBAR_DEFAULT_WIDTH, expandedWidth: LEFT_SIDEBAR_DEFAULT_WIDTH },
    rightPanel: { collapsed: false, width: RIGHT_PANEL_DEFAULT_WIDTH, expandedWidth: RIGHT_PANEL_DEFAULT_WIDTH },
    terminal: { height: TERMINAL_DEFAULT_HEIGHT },
    window: {
      width: APP_DEFAULT_WINDOW_WIDTH,
      height: APP_DEFAULT_WINDOW_HEIGHT,
      x: 0,
      y: 0,
      isMaximized: false,
    },
  },
  profile: { nickname: 'RDC Operator', avatarPath: '' },
  tooling: {
    rdxCli: {
      enabled: false,
      command: '',
      argsPrefix: [],
      workingDirectory: '',
      env: {},
      timeoutMs: 60000,
      catalogPath: '',
      jsonMode: 'auto',
    },
    rdxActions: {
      openCapture: createEmptyRdxAction(),
      openRemoteCapture: createEmptyRdxAction(),
      connectRemote: createEmptyRdxAction(),
      closeRuntime: createEmptyRdxAction(),
    },
    codeInterpreter: {
      enabled: false,
      command: '',
      argsPrefix: [],
      timeoutMs: 60000,
      env: {},
      artifactsEnabled: true,
    },
    shell: {
      executable: '',
    },
  },
  agentRuntime: {
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
  },
  llm: { providers: [], agentRoutes: createEmptyAgentRoutes() },
  agents: { directoryPath: '', definitions: [], modelOptions: [], globalInstructions: '', diagnostics: [] },
  resourceCatalog: {
    availableSkills: [],
    availableMcpServers: [],
    diagnostics: [],
  },
  paths: {
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
  },
};

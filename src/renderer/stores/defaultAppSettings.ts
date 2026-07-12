import type { AppSettings, LlmAgentRoute } from '@shared/types/settings';
import {
  LEFT_SIDEBAR_DEFAULT_WIDTH,
  RIGHT_PANEL_DEFAULT_WIDTH,
  TERMINAL_DEFAULT_HEIGHT,
} from '@shared/constants/layout';
import { DEFAULT_MODEL_ROUTING } from '@shared/types/agent';

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
  appearance: {
    theme: 'dark',
    language: 'zh-CN',
    fontScale: 'medium',
    composerMarkdown: false,
    usePointerCursors: false,
  },
  layout: {
    leftSidebar: { collapsed: false, width: LEFT_SIDEBAR_DEFAULT_WIDTH, expandedWidth: LEFT_SIDEBAR_DEFAULT_WIDTH },
    rightPanel: { collapsed: false, width: RIGHT_PANEL_DEFAULT_WIDTH, expandedWidth: RIGHT_PANEL_DEFAULT_WIDTH },
    terminal: { height: TERMINAL_DEFAULT_HEIGHT },
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
      connectRemote: createEmptyRdxAction(),
      closeRuntime: createEmptyRdxAction(),
      openPreview: createEmptyRdxAction(),
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
  },
  llm: { providers: [], agentRoutes: createEmptyAgentRoutes() },
  agents: { directoryPath: '', definitions: [], modelOptions: [], globalInstructions: '' },
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

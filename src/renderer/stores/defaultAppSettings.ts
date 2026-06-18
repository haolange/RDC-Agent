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
  appearance: { theme: 'dark', language: 'zh-CN', fontScale: 'medium' },
  layout: {
    leftSidebar: { collapsed: false, width: LEFT_SIDEBAR_DEFAULT_WIDTH, expandedWidth: LEFT_SIDEBAR_DEFAULT_WIDTH },
    rightPanel: { collapsed: false, width: RIGHT_PANEL_DEFAULT_WIDTH, expandedWidth: RIGHT_PANEL_DEFAULT_WIDTH },
    terminal: { height: TERMINAL_DEFAULT_HEIGHT },
  },
  profile: { nickname: 'RDC Operator', avatarPath: '' },
  workspace: { rootPath: '' },
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
  configuration: {
    activeModeProfileId: 'debugger.default',
    availableModeProfiles: [],
    enabledMcpServerIds: [],
    modePatternBindings: { debugger: 'free-agent', analyzer: 'free-agent', optimizer: 'free-agent' },
    availablePatterns: [],
    availableSkills: [],
    availableMcpServers: [],
    diagnostics: [],
    lastMigrationSummary: [],
  },
  paths: {
    workspaceRoot: '',
    defaultWorkspaceRoot: '',
    settingsPath: '',
    logsPath: '',
    logPath: '',
    projectsPath: '',
    knowledgePath: '',
    migrationOrphansPath: '',
    profilesPath: '',
    policiesPath: '',
    skillsPath: '',
    mcpPath: '',
    patternsPath: '',
    secretsPath: '',
    migrationReportsPath: '',
  },
};

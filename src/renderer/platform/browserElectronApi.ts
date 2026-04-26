import type { AgentRole, AgentState } from '@shared/types/agent';
import type {
  ConversationCancelActiveTurnRequest,
  ConversationMessage,
  ConversationSendRequest,
  ConversationStreamEvent,
  ConversationTurnResult,
} from '@shared/types/conversation';
import type { ReplayDeviceEntry, ReplayDeviceStatusChangedPayload } from '@shared/types/device';
import type { ActionEvent } from '@shared/types/evidence';
import type { LLMConfig } from '@shared/types/llm';
import type { RuntimeLogEntry, RuntimeLogScope } from '@shared/types/runtimeLog';
import type {
  AppSettings,
  AppSettingsPatch,
  LlmAgentRoute,
  ResolvedTheme,
} from '@shared/types/settings';
import type {
  CaptureDescriptor,
  ContextSnapshot,
  DebugSessionStartRequest,
  OpenProjectInputRequest,
  OpenedCaptureState,
  ProjectInputRecord,
  ProjectRecord,
  RunContextUsageSummary,
  RunSummary,
  SessionAttachmentRecord,
  SessionOutputRecord,
  SessionRecord,
} from '@shared/types/session';
import type { TerminalCreateTabRequest, TerminalDataEvent, TerminalExitEvent, TerminalTabRecord } from '@shared/types/terminal';
import type { ToolCatalog, ToolNamespace, ToolRuntimeSummary } from '@shared/types/tool';
import type {
  AskUserPrompt,
  DebugPlan,
  WorkflowState,
} from '@shared/types/workflow';
import type { ElectronAPI } from '@shared/types/electron';
import {
  LEFT_SIDEBAR_DEFAULT_WIDTH,
  RIGHT_PANEL_DEFAULT_WIDTH,
  TERMINAL_DEFAULT_HEIGHT,
} from '@shared/constants/layout';

const FALLBACK_MARKER = '__RDC_AGENT_BROWSER_ELECTRON_API_FALLBACK__';
const NOW = Date.now();

type BrowserFallbackWindow = Window & {
  [FALLBACK_MARKER]?: true;
};

type EventCallback = (...args: unknown[]) => void;

const agentRoles: AgentRole[] = [
  'rdc-debugger',
  'triage_agent',
  'capture_repro_agent',
  'pass_graph_pipeline_agent',
  'pixel_forensics_agent',
  'shader_ir_agent',
  'driver_device_agent',
  'skeptic_agent',
  'curator_agent',
];

const toolNamespaces: ToolNamespace[] = [
  'capture',
  'session',
  'event',
  'replay',
  'pipeline',
  'shader',
  'texture',
  'resource',
  'export',
  'remote',
  'core',
  'macro',
  'vfs',
];

const createId = (prefix: string): string => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createSettings = (): AppSettings => {
  const agentRoutes: LlmAgentRoute[] = agentRoles.map((agentId) => ({
    agentId,
    providerId: 'browser-preview',
    modelId: 'browser-preview-model',
  }));

  return {
    appearance: {
      theme: 'dark',
      language: 'zh-CN',
      fontScale: 'medium',
    },
    layout: {
      leftSidebar: {
        collapsed: false,
        width: LEFT_SIDEBAR_DEFAULT_WIDTH,
        expandedWidth: LEFT_SIDEBAR_DEFAULT_WIDTH,
      },
      rightPanel: {
        collapsed: false,
        width: RIGHT_PANEL_DEFAULT_WIDTH,
        expandedWidth: RIGHT_PANEL_DEFAULT_WIDTH,
      },
      terminal: {
        height: TERMINAL_DEFAULT_HEIGHT,
      },
    },
    profile: {
      nickname: 'Browser Preview',
      avatarPath: '',
    },
    workspace: {
      rootPath: 'H:\\rdx\\RDC-Agent\\.browser-preview',
    },
    llm: {
      providers: [
        {
          id: 'browser-preview',
          kind: 'openai-compatible',
          label: 'Browser Preview Provider',
          enabled: true,
          apiKey: '',
          secretRef: 'browser-preview-api-key',
          hasStoredSecret: false,
          baseUrl: 'http://127.0.0.1/browser-preview',
          models: [
            {
              id: 'browser-preview-model',
              label: 'Browser Preview Model',
              enabled: true,
              contextWindowTokens: 8192,
            },
          ],
          recommendedModels: ['browser-preview-model'],
          docsUrl: '',
          isConfigured: true,
        },
      ],
      agentRoutes,
    },
    configuration: {
      activeModeProfileId: 'debugger.default',
      availableModeProfiles: [],
      diagnostics: [],
      lastMigrationSummary: [],
    },
    paths: {
      workspaceRoot: 'H:\\rdx\\RDC-Agent\\.browser-preview',
      defaultWorkspaceRoot: 'H:\\rdx\\RDC-Agent\\.browser-preview',
      settingsPath: 'H:\\rdx\\RDC-Agent\\.browser-preview\\settings.json',
      logsPath: 'H:\\rdx\\RDC-Agent\\.browser-preview\\logs',
      logPath: 'H:\\rdx\\RDC-Agent\\.browser-preview\\logs\\rdc-agent.log',
      projectsPath: 'H:\\rdx\\RDC-Agent\\.browser-preview\\projects',
      knowledgePath: 'H:\\rdx\\RDC-Agent\\.browser-preview\\knowledge',
      migrationOrphansPath: 'H:\\rdx\\RDC-Agent\\.browser-preview\\migration-orphans',
      profilesPath: 'H:\\rdx\\RDC-Agent\\.browser-preview\\profiles',
      policiesPath: 'H:\\rdx\\RDC-Agent\\.browser-preview\\policies',
      secretsPath: 'H:\\rdx\\RDC-Agent\\.browser-preview\\secrets',
      migrationReportsPath: 'H:\\rdx\\RDC-Agent\\.browser-preview\\migration-reports',
    },
  };
};

const previewInput: ProjectInputRecord = {
  inputId: 'browser-preview-capture',
  fileName: 'preview-frame.rdc',
  filePath: 'H:\\rdx\\RDC-Agent\\.browser-preview\\captures\\preview-frame.rdc',
  source: 'project_resource',
  discoveredAt: NOW - 1000 * 60 * 30,
  lastModifiedAt: NOW - 1000 * 60 * 15,
  size: 5_242_880,
};

const previewProject: ProjectRecord = {
  projectId: 'browser-preview-project',
  name: 'Browser Preview Project',
  rootPath: 'H:\\rdx\\RDC-Agent\\.browser-preview\\projects\\browser-preview',
  slug: 'browser-preview-project',
  resourcePath: 'H:\\rdx\\RDC-Agent\\.browser-preview\\projects\\browser-preview\\resources',
  knowledgePath: 'H:\\rdx\\RDC-Agent\\.browser-preview\\projects\\browser-preview\\knowledge',
  inputsPath: 'H:\\rdx\\RDC-Agent\\.browser-preview\\projects\\browser-preview\\inputs',
  inputs: [previewInput],
  inputsUpdatedAt: NOW - 1000 * 60 * 12,
  createdAt: NOW - 1000 * 60 * 60,
  updatedAt: NOW - 1000 * 60 * 10,
  lastSessionId: 'browser-preview-session-1',
};

const previewSessions: SessionRecord[] = [
  {
    sessionId: 'browser-preview-session-1',
    projectId: previewProject.projectId,
    title: 'Inspect lighting mismatch',
    goal: 'Investigate a frame where the RenderDoc capture shows a lighting mismatch.',
    sessionPath: 'H:\\rdx\\RDC-Agent\\.browser-preview\\sessions\\inspect-lighting-mismatch',
    createdAt: NOW - 1000 * 60 * 50,
    updatedAt: NOW - 1000 * 60 * 8,
    lastRunId: 'browser-preview-run-1',
  },
  {
    sessionId: 'browser-preview-session-2',
    projectId: previewProject.projectId,
    title: 'Validate capture intake',
    goal: 'Preview the capture intake and session panels in a normal browser.',
    sessionPath: 'H:\\rdx\\RDC-Agent\\.browser-preview\\sessions\\validate-capture-intake',
    createdAt: NOW - 1000 * 60 * 40,
    updatedAt: NOW - 1000 * 60 * 20,
  },
];

const previewDevice: ReplayDeviceEntry = {
  id: 'local',
  label: 'Local Browser Preview',
  type: 'local',
  status: 'online',
  transport: 'local',
  detailText: 'Browser preview replay mock',
  lastSeen: NOW,
};

const createCaptureDescriptor = (status: CaptureDescriptor['status']): CaptureDescriptor => ({
  id: previewInput.inputId,
  filePath: previewInput.filePath,
  captureFileId: previewInput.inputId,
  role: 'primary',
  backendHint: 'local',
  status,
  sessionId: previewSessions[0].sessionId,
  replaySessionId: 'browser-preview-replay',
  contextId: 'browser-preview-context',
});

const createOpenedCaptureState = (status: OpenedCaptureState['status']): OpenedCaptureState => ({
  projectId: previewProject.projectId,
  inputId: previewInput.inputId,
  filePath: previewInput.filePath,
  captureId: previewInput.inputId,
  captureFileId: previewInput.inputId,
  sessionId: previewSessions[0].sessionId,
  contextId: 'browser-preview-context',
  replaySessionId: 'browser-preview-replay',
  backend: 'local',
  deviceId: previewDevice.id,
  deviceLabel: previewDevice.label,
  status,
  openedAt: Date.now(),
  preview: null,
});

const createContextSnapshot = (): ContextSnapshot => ({
  contextId: 'browser-preview-context',
  sessionId: previewSessions[0].sessionId,
  backend: 'local',
  runtimeOwner: 'browser-preview',
  ownerLeaseId: 'browser-preview-lease',
  captureDescriptors: [createCaptureDescriptor('open')],
  activeCapture: previewInput.inputId,
  deviceLabel: previewDevice.label,
  humanPreview: {
    status: 'closed',
    updatedAt: Date.now(),
  },
});

const createDebugPlan = (): DebugPlan => ({
  planId: 'browser-preview-plan',
  planReadiness: 'strict_ready',
  strictReady: true,
  userGoal: previewSessions[0].goal,
  targetCapture: {
    captureId: previewInput.inputId,
    fileName: previewInput.fileName,
    filePath: previewInput.filePath,
  },
  targetFrameOrEvent: {
    scope: 'capture',
  },
  scope: 'Browser preview smoke workflow',
  referenceContract: {
    taskSources: ['Browser preview seeded state'],
    referenceCaptures: [previewInput.fileName],
    acceptanceNotes: ['Renderer should remain interactive without Electron preload.'],
  },
  verificationContract: {
    requiresFixValidation: false,
    requiresScreenshotEvidence: false,
    requiresShaderInspection: false,
    requiresPixelEvidence: false,
    requiresBaselineComparison: false,
    targetEventIds: [],
    successCriteria: ['Sidebar and workbench render in a normal browser.'],
  },
  expectedDeliverables: ['Interactive UI preview'],
  blockers: [],
  missingInfo: [],
  recommendedSpecialists: ['triage_agent'],
  notes: ['This plan is generated by the browser Electron API fallback.'],
  createdAt: new Date(NOW - 1000 * 60 * 6).toISOString(),
  updatedAt: new Date(NOW - 1000 * 60 * 5).toISOString(),
});

const createWorkflowState = (): WorkflowState => ({
  caseId: 'browser-preview-case',
  runId: 'browser-preview-run-1',
  sessionId: previewSessions[0].sessionId,
  currentStage: 'plan',
  previousStages: ['preflight', 'entry_gate', 'intake_gate'],
  entryMode: 'mcp',
  backend: 'local',
  orchestrationMode: 'multi_agent',
  coordinationMode: 'staged_handoff',
  blockers: [],
  planReadiness: 'strict_ready',
  approvalState: 'pending_user',
  debugPlan: createDebugPlan(),
  pendingQuestions: null,
  reasoningSummaries: [
    {
      summaryId: 'browser-preview-reasoning',
      stage: 'plan',
      agentId: 'rdc-debugger',
      summary: 'Preview state is ready for Browser Use inspection.',
      evidence: ['Mock project and session records are loaded.'],
      nextStep: 'Approve or interact with the workbench controls.',
      confidence: 0.95,
      createdAt: new Date(NOW - 1000 * 60 * 4).toISOString(),
    },
  ],
  recoveryState: null,
  lastUpdated: new Date(NOW - 1000 * 60 * 4).toISOString(),
});

const createRun = (): RunSummary => ({
  runId: 'browser-preview-run-1',
  turnId: 'browser-preview-turn-1',
  projectId: previewProject.projectId,
  sessionId: previewSessions[0].sessionId,
  caseId: 'browser-preview-case',
  mode: 'debugger',
  goal: previewSessions[0].goal,
  captures: [createCaptureDescriptor('open')],
  startedAt: NOW - 1000 * 60 * 8,
  status: 'awaiting_approval',
  lastStage: 'plan',
  backend: 'local',
});

const createConversationMessage = (
  role: ConversationMessage['role'],
  content: string,
  patch: Partial<ConversationMessage> = {},
): ConversationMessage => ({
  id: createId(`browser-preview-${role}`),
  turnId: patch.turnId ?? 'browser-preview-turn-1',
  sessionId: patch.sessionId ?? previewSessions[0].sessionId,
  projectId: patch.projectId ?? previewProject.projectId,
  runId: patch.runId ?? 'browser-preview-run-1',
  modeContext: patch.modeContext ?? 'debugger',
  role,
  agentId: role === 'assistant' ? 'rdc-debugger' : undefined,
  content,
  status: 'complete',
  updatedAt: Date.now(),
  reasoningTrace: role === 'assistant'
    ? {
      status: 'complete',
      summary: 'Browser preview response',
      steps: [],
      updatedAt: Date.now(),
    }
    : null,
  attachments: [],
  createdAt: Date.now(),
  ...patch,
});

class BrowserElectronApiFallback {
  private settings = createSettings();
  private projects: ProjectRecord[] = [previewProject];
  private sessions: SessionRecord[] = previewSessions;
  private runs: RunSummary[] = [createRun()];
  private currentProjectId: string | null = previewProject.projectId;
  private currentSessionId: string | null = previewSessions[0].sessionId;
  private workflowState: WorkflowState = createWorkflowState();
  private openedCapture: OpenedCaptureState | null = createOpenedCaptureState('open');
  private contextSnapshot: ContextSnapshot | null = createContextSnapshot();
  private devices: ReplayDeviceEntry[] = [previewDevice];
  private terminalTabs: TerminalTabRecord[] = [];
  private runtimeLogs: RuntimeLogEntry[] = [
    {
      id: 'browser-preview-log-1',
      timestamp: NOW - 1000 * 60 * 7,
      scope: 'session',
      namespace: 'capture',
      severity: 'info',
      title: 'Capture context loaded',
      summary: 'Browser preview capture is ready for inspection.',
      projectId: previewProject.projectId,
      sessionId: previewSessions[0].sessionId,
      runId: 'browser-preview-run-1',
    },
    {
      id: 'browser-preview-log-2',
      timestamp: NOW - 1000 * 60 * 6,
      scope: 'session',
      namespace: 'tool',
      severity: 'warning',
      title: 'Tool retry scheduled',
      summary: 'rd.inspect will retry with browser-preview fallback arguments.',
      detail: 'The first preview tool route did not provide enough metadata.',
      projectId: previewProject.projectId,
      sessionId: previewSessions[0].sessionId,
      runId: 'browser-preview-run-1',
      raw: {
        tool: 'rd.inspect',
        mode: 'browser-preview',
      },
    },
    {
      id: 'browser-preview-log-3',
      timestamp: NOW - 1000 * 60 * 5,
      scope: 'app',
      namespace: 'system',
      severity: 'info',
      title: 'Browser preview fallback active',
      summary: 'Renderer is using an in-memory Electron API mock.',
      projectId: previewProject.projectId,
      sessionId: null,
      runId: null,
    },
  ];
  private conversations = new Map<string, ConversationMessage[]>([
    [
      previewSessions[0].sessionId,
      [
        createConversationMessage('user', 'Please inspect the lighting mismatch in this capture.', {
          id: 'browser-preview-user-1',
          createdAt: NOW - 1000 * 60 * 6,
          updatedAt: NOW - 1000 * 60 * 6,
        }),
        createConversationMessage('assistant', 'I found a browser-preview capture and prepared the workbench state for inspection.', {
          id: 'browser-preview-assistant-1',
          createdAt: NOW - 1000 * 60 * 5,
          updatedAt: NOW - 1000 * 60 * 5,
        }),
      ],
    ],
  ]);
  private listeners = new Map<string, Set<EventCallback>>();

  readonly api: ElectronAPI = {
    platform: 'win32',
    isMac: false,
    isWindows: true,
    isLinux: false,

    appMeta: {
      get: async () => ({
        version: 'browser-preview',
        productName: 'RDC Agent Browser Preview',
        systemTheme: 'dark',
      }),
    },

    appShell: {
      selectAvatar: async () => null,
      getAvatarDataUrl: async () => null,
      openPath: async () => ({ success: true }),
      copyText: async (text) => {
        await navigator.clipboard?.writeText(text).catch(() => undefined);
        return { success: true };
      },
    },

    conversation: {
      sendMessage: async (request) => this.sendConversationMessage(request),
      cancelActiveTurn: async (request?: ConversationCancelActiveTurnRequest) => this.cancelActiveTurn(request),
      getHistory: async (sessionId) => ({
        messages: this.conversations.get(sessionId) ?? [],
      }),
      onEvent: (callback) => this.on('conversation:event', callback as EventCallback),
      offEvent: (callback) => this.off('conversation:event', callback as EventCallback),
    },

    selectFiles: async () => null,
    selectRdcFiles: async () => null,
    selectDirectory: async () => null,

    workflow: {
      getState: async () => this.workflowState,
      start: async (request) => this.startWorkflow(request),
      getPlan: async (runId) => ({
        success: true,
        runId,
        sessionId: this.workflowState.sessionId,
        debugPlan: this.workflowState.debugPlan ?? null,
        pendingQuestions: this.workflowState.pendingQuestions ?? null,
        approvalState: this.workflowState.approvalState,
      }),
      submitQuestions: async (_runId, _answers) => this.updatePlanState('awaiting_approval', null),
      approvePlan: async (runId) => {
        this.workflowState = {
          ...this.workflowState,
          runId,
          currentStage: 'dispatch',
          previousStages: [...this.workflowState.previousStages, this.workflowState.currentStage],
          approvalState: 'approved',
          lastUpdated: new Date().toISOString(),
        };
        this.runs = this.runs.map((run) => run.runId === runId ? { ...run, status: 'running', lastStage: 'dispatch' } : run);
        this.emit('workflow:stateChanged', this.workflowState);
        return {
          success: true,
          runId,
          sessionId: this.workflowState.sessionId,
          debugPlan: this.workflowState.debugPlan ?? null,
          pendingQuestions: null,
          approvalState: this.workflowState.approvalState,
        };
      },
      restartRun: async (runId) => this.updatePlanState('awaiting_approval', runId),
      resume: async () => ({ success: true }),
      stop: async (runId) => {
        this.runs = this.runs.map((run) => run.runId === runId ? { ...run, status: 'cancelled', stoppedAt: Date.now() } : run);
        return { success: true };
      },
      getRunUsage: async (runId) => ({
        usage: runId ? this.createUsage(runId) : null,
      }),
      listRuns: async () => ({ runs: this.runs }),
      listActiveRuns: async () => ({
        runs: this.runs
          .filter((run) => ['queued', 'planning', 'awaiting_input', 'awaiting_approval', 'running'].includes(run.status))
          .map((run) => ({
            runId: run.runId,
            sessionId: run.sessionId,
            projectId: run.projectId,
            startedAt: run.startedAt,
            stage: run.lastStage,
          })),
      }),
      advanceStage: async () => ({ success: true, currentStage: this.workflowState.currentStage }),
      backtrack: async (_reason, _trigger) => ({ success: true }),
      dispatchSpecialist: async (agentId) => ({ success: true, tokenId: `browser-preview-token-${agentId}` }),
    },

    agent: {
      sendMessage: async (_agentId, content) => ({ response: `Browser preview response: ${content}` }),
      getState: async (agentId) => this.createAgentState(agentId),
      getAllStates: async () => agentRoles.map((agentId) => this.createAgentState(agentId)),
      configure: async (_agentId, _config) => ({ success: true }),
    },

    tool: {
      getCatalog: async () => this.createToolCatalog(),
      getRuntimeSummary: async () => this.createToolRuntimeSummary(),
      execute: async (toolName, _args) => ({
        ok: true,
        data: { toolName, mode: 'browser-preview' },
        duration_ms: 1,
        trace_id: createId('browser-preview-trace'),
      }),
    },

    evidence: {
      getChain: async () => ({
        sessionId: this.workflowState.sessionId,
        runId: this.workflowState.runId,
        events: this.createActionEvents(),
        isValid: true,
      }),
      getEvents: async (eventType) => this.createActionEvents().filter((event) => !eventType || event.event_type === eventType),
    },

    llm: {
      configure: async (_config: LLMConfig) => undefined,
      testConnection: async () => ({ success: true }),
      getAvailableModels: async () => ['browser-preview-model'],
    },

    settings: {
      get: async () => this.settings,
      getProviderSecret: async () => '',
      set: async (patch) => {
        this.settings = this.applySettingsPatch(this.settings, patch);
        this.emit('app:themeChanged', this.resolveTheme());
        return this.settings;
      },
    },

    project: {
      list: async () => ({ projects: this.projects }),
      add: async (rootPath) => this.addProject(rootPath),
      select: async (projectId) => this.selectProject(projectId),
      rename: async (projectId, newName) => this.renameProject(projectId, newName),
      remove: async (projectId) => this.removeProject(projectId),
      inputs: {
        list: async (projectId) => ({ inputs: this.getProjectInputs(projectId) }),
        refresh: async (projectId) => ({ inputs: this.getProjectInputs(projectId) }),
        import: async (projectId) => ({ success: true, inputs: this.getProjectInputs(projectId) }),
        importPaths: async (projectId, filePaths) => this.importProjectInputs(projectId, filePaths),
      },
    },

    device: {
      list: async () => this.devices,
      refresh: async () => this.devices,
      activate: async (deviceId) => {
        const device = this.devices.find((entry) => entry.id === deviceId) ?? this.devices[0];
        return device;
      },
    },

    session: {
      list: async (projectId) => ({ sessions: this.getSessions(projectId) }),
      create: async (projectId, title) => this.createSession(projectId, title),
      rename: async (id, title) => this.renameSession(id, title),
      remove: async (id) => this.removeSession(id),
      select: async (id) => this.selectSession(id),
    attachments: {
        list: async (sessionId) => ({ attachments: this.createAttachments(sessionId) }),
      import: async (sessionId, filePaths) => ({
        success: true,
        attachments: filePaths.map((filePath) => this.createAttachment(sessionId, filePath)),
      }),
    },
    outputs: {
      list: async (sessionId, runId) => ({
        outputs: this.createOutputs(sessionId, runId),
      }),
    },
  },

    run: {
      list: async (sessionId) => ({ runs: this.runs.filter((run) => run.sessionId === sessionId) }),
    },

    runtimeLog: {
      list: async (request) => ({
        entries: this.runtimeLogs.filter((entry) => this.matchesLogScope(entry, request.scope, request.sessionId)),
      }),
    },

    terminal: {
      listTabs: async () => ({ tabs: this.terminalTabs }),
      createTab: async (request) => this.createTerminalTab(request),
      closeTab: async (tabId) => this.closeTerminalTab(tabId),
      activateTab: async (tabId) => ({ success: this.terminalTabs.some((tab) => tab.tabId === tabId), tabs: this.terminalTabs }),
      write: async (tabId, data) => {
        this.emit('terminal:data', { tabId, data } satisfies TerminalDataEvent);
        return { success: true };
      },
      resize: async (_tabId, _cols, _rows) => ({ success: true }),
    },

    capture: {
      list: async () => ({ captures: this.contextSnapshot?.captureDescriptors ?? [] }),
      select: async (_captureId) => ({ success: true }),
      openProjectInput: async (request) => this.openProjectInput(request),
      getOpenedState: async () => this.openedCapture,
      clearOpenedState: async () => {
        this.openedCapture = null;
        this.contextSnapshot = null;
        this.emit('capture:openedStateChanged', null);
        return { success: true };
      },
    },

    context: {
      get: async () => this.contextSnapshot ?? createContextSnapshot(),
      openHumanPreview: async (request) => this.openHumanPreview(request?.sessionId),
      closeHumanPreview: async () => this.closeHumanPreview(),
    },

    events: {
      onWorkflowStateChanged: (callback) => this.on('workflow:stateChanged', callback as EventCallback),
      onWorkflowStageChanged: (callback) => this.on('workflow:stageChanged', callback as EventCallback),
      onRunStatusChanged: (callback) => this.on('workflow:runStatusChanged', callback as EventCallback),
      onRunUsageChanged: (callback) => this.on('workflow:runUsageChanged', callback as EventCallback),
      onAgentMessage: (callback) => this.on('agent:message', callback as EventCallback),
      onAgentStatusChanged: (callback) => this.on('agent:statusChanged', callback as EventCallback),
      onToolExecutionComplete: (callback) => this.on('tool:executionComplete', callback as EventCallback),
      onEvidenceEventAdded: (callback) => this.on('evidence:eventAdded', callback as EventCallback),
      onDeviceStatusChanged: (callback) => this.on('device:statusChanged', callback as EventCallback),
      onCaptureStatusChanged: (callback) => this.on('capture:statusChanged', callback as EventCallback),
      onContextChanged: (callback) => this.on('context:changed', callback as EventCallback),
      onProjectInputsChanged: (callback) => this.on('project:inputsChanged', callback as EventCallback),
      onOpenedCaptureStateChanged: (callback) => this.on('capture:openedStateChanged', callback as EventCallback),
      onRuntimeLogAppended: (callback) => this.on('runtime:logAppended', callback as EventCallback),
      onTerminalData: (callback) => this.on('terminal:data', callback as EventCallback),
      onTerminalExit: (callback) => this.on('terminal:exit', callback as EventCallback),
      onTerminalTabsChanged: (callback) => this.on('terminal:tabsChanged', callback as EventCallback),
      onAppThemeChanged: (callback) => this.on('app:themeChanged', callback as EventCallback),
      removeAllListeners: (channel) => this.removeAllListeners(channel),
    },

    windowControls: {
      minimize: async () => undefined,
      toggleMaximize: async () => false,
      close: async () => undefined,
      isMaximized: async () => false,
    },

    on: (channel, callback) => this.on(channel, callback),
    off: (channel, callback) => this.off(channel, callback),
  };

  private on(channel: string, callback: EventCallback): (() => void) {
    const listeners = this.listeners.get(channel) ?? new Set<EventCallback>();
    listeners.add(callback);
    this.listeners.set(channel, listeners);
    return () => this.off(channel, callback);
  }

  private off(channel: string, callback: EventCallback): void {
    this.listeners.get(channel)?.delete(callback);
  }

  private emit(channel: string, ...args: unknown[]): void {
    for (const callback of this.listeners.get(channel) ?? []) {
      callback(...args);
    }
  }

  private removeAllListeners(channel: string): void {
    this.listeners.delete(channel);
  }

  private resolveTheme(): ResolvedTheme {
    if (this.settings.appearance.theme === 'light') {
      return 'light';
    }
    return 'dark';
  }

  private applySettingsPatch(current: AppSettings, patch: AppSettingsPatch): AppSettings {
    return {
      ...current,
      appearance: {
        ...current.appearance,
        ...patch.appearance,
      },
        layout: {
          leftSidebar: {
            ...current.layout.leftSidebar,
            ...patch.layout?.leftSidebar,
          },
          rightPanel: {
            ...current.layout.rightPanel,
            ...patch.layout?.rightPanel,
          },
          terminal: {
            ...current.layout.terminal,
            ...patch.layout?.terminal,
          },
        },
      profile: {
        ...current.profile,
        ...patch.profile,
      },
      workspace: {
        ...current.workspace,
        ...patch.workspace,
      },
      llm: {
        providers: patch.llm?.providers ?? current.llm.providers,
        agentRoutes: patch.llm?.agentRoutes ?? current.llm.agentRoutes,
      },
      configuration: {
        ...current.configuration,
        ...patch.configuration,
      },
    };
  }

  private getSessions(projectId?: string): SessionRecord[] {
    return projectId ? this.sessions.filter((session) => session.projectId === projectId) : this.sessions;
  }

  private getProjectInputs(projectId: string): ProjectInputRecord[] {
    return this.projects.find((project) => project.projectId === projectId)?.inputs ?? [];
  }

  private async addProject(rootPath: string): Promise<{ success: boolean; project?: ProjectRecord; error?: string }> {
    const projectId = createId('browser-preview-project');
    const name = rootPath.split(/[\\/]/).filter(Boolean).pop() || 'Browser Preview Project';
    const project: ProjectRecord = {
      ...previewProject,
      projectId,
      name,
      rootPath,
      slug: projectId,
      inputs: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastSessionId: undefined,
    };
    this.projects = [...this.projects, project];
    this.currentProjectId = project.projectId;
    this.currentSessionId = null;
    return { success: true, project };
  }

  private async selectProject(projectId: string): Promise<{
    success: boolean;
    project?: ProjectRecord;
    currentSession?: SessionRecord | null;
    currentRun?: RunSummary | null;
    error?: string;
  }> {
    const project = this.projects.find((entry) => entry.projectId === projectId);
    if (!project) {
      return { success: false, error: 'Project not found' };
    }

    this.currentProjectId = projectId;
    const selectedSession = this.currentSessionId
      ? this.sessions.find((entry) => entry.sessionId === this.currentSessionId) ?? null
      : null;
    if (!selectedSession || selectedSession.projectId !== projectId) {
      this.currentSessionId = null;
      return {
        success: true,
        project,
        currentSession: null,
        currentRun: null,
      };
    }

    const currentRun = this.runs.find((run) => run.sessionId === selectedSession.sessionId) ?? null;
    return {
      success: true,
      project,
      currentSession: selectedSession,
      currentRun,
    };
  }

  private async renameProject(projectId: string, newName: string): Promise<{ success: boolean; project?: ProjectRecord; error?: string }> {
    let renamed: ProjectRecord | undefined;
    this.projects = this.projects.map((project) => {
      if (project.projectId !== projectId) {
        return project;
      }
      renamed = { ...project, name: newName, updatedAt: Date.now() };
      return renamed;
    });
    return renamed ? { success: true, project: renamed } : { success: false, error: 'Project not found' };
  }

  private async removeProject(projectId: string): Promise<{ success: boolean; error?: string }> {
    this.projects = this.projects.filter((project) => project.projectId !== projectId);
    this.sessions = this.sessions.filter((session) => session.projectId !== projectId);
    this.runs = this.runs.filter((run) => run.projectId !== projectId);
    if (this.currentProjectId === projectId) {
      this.currentProjectId = null;
      this.currentSessionId = null;
    }
    return { success: true };
  }

  private async importProjectInputs(
    projectId: string,
    filePaths: string[],
  ): Promise<{ success: boolean; inputs: ProjectInputRecord[]; error?: string }> {
    const nextInputs = filePaths.map<ProjectInputRecord>((filePath) => ({
      inputId: createId('browser-preview-input'),
      fileName: filePath.split(/[\\/]/).filter(Boolean).pop() || 'capture.rdc',
      filePath,
      source: 'project_resource',
      discoveredAt: Date.now(),
      lastModifiedAt: Date.now(),
      size: 1_048_576,
    }));
    this.projects = this.projects.map((project) => (
      project.projectId === projectId
        ? { ...project, inputs: [...project.inputs, ...nextInputs], inputsUpdatedAt: Date.now() }
        : project
    ));
    return { success: true, inputs: this.getProjectInputs(projectId) };
  }

  private async createSession(
    projectId: string,
    title = 'Browser Preview Session',
  ): Promise<{ success: boolean; session?: SessionRecord; error?: string }> {
    const session: SessionRecord = {
      sessionId: createId('browser-preview-session'),
      projectId,
      title,
      goal: 'Browser preview session',
      sessionPath: `H:\\rdx\\RDC-Agent\\.browser-preview\\sessions\\${title.replace(/\s+/g, '-').toLowerCase()}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.sessions = [session, ...this.sessions];
    this.projects = this.projects.map((project) => (
      project.projectId === projectId ? { ...project, lastSessionId: session.sessionId, updatedAt: Date.now() } : project
    ));
    this.currentProjectId = projectId;
    this.currentSessionId = session.sessionId;
    return { success: true, session };
  }

  private async renameSession(id: string, title: string): Promise<{ success: boolean; session?: SessionRecord; error?: string }> {
    let renamed: SessionRecord | undefined;
    this.sessions = this.sessions.map((session) => {
      if (session.sessionId !== id) {
        return session;
      }
      renamed = { ...session, title, updatedAt: Date.now() };
      return renamed;
    });
    return renamed ? { success: true, session: renamed } : { success: false, error: 'Session not found' };
  }

  private async removeSession(id: string): Promise<{
    success: boolean;
    nextSession?: SessionRecord | null;
    nextRun?: RunSummary | null;
    error?: string;
  }> {
    const removed = this.sessions.find((session) => session.sessionId === id);
    this.sessions = this.sessions.filter((session) => session.sessionId !== id);
    this.runs = this.runs.filter((run) => run.sessionId !== id);
    const nextSession = removed ? this.getSessions(removed.projectId)[0] ?? null : null;
    const nextRun = nextSession ? this.runs.find((run) => run.sessionId === nextSession.sessionId) ?? null : null;
    if (removed && this.currentSessionId === id) {
      this.currentProjectId = removed.projectId;
      this.currentSessionId = nextSession?.sessionId ?? null;
    }
    return { success: true, nextSession, nextRun };
  }

  private async selectSession(id: string): Promise<{ success: boolean; session?: SessionRecord; currentRun?: RunSummary | null; error?: string }> {
    const session = this.sessions.find((entry) => entry.sessionId === id);
    if (!session) {
      return { success: false, error: 'Session not found' };
    }
    const currentRun = this.runs.find((run) => run.sessionId === id) ?? null;
    this.currentProjectId = session.projectId;
    this.currentSessionId = session.sessionId;
    return { success: true, session, currentRun };
  }

  private createAttachment(sessionId: string, filePath: string): SessionAttachmentRecord {
    const session = this.sessions.find((entry) => entry.sessionId === sessionId);
    return {
      attachmentId: createId('browser-preview-attachment'),
      sessionId,
      projectId: session?.projectId ?? previewProject.projectId,
      kind: 'file',
      fileName: filePath.split(/[\\/]/).filter(Boolean).pop() || 'attachment.txt',
      filePath,
      mimeType: 'application/octet-stream',
      size: 1024,
      createdAt: Date.now(),
    };
  }

  private createAttachments(sessionId: string): SessionAttachmentRecord[] {
    return [
      this.createAttachment(sessionId, 'H:\\rdx\\RDC-Agent\\.browser-preview\\notes\\preview-note.md'),
    ];
  }

  private createOutputs(sessionId: string, runId?: string): SessionOutputRecord[] {
    const run = this.runs.find((entry) => entry.runId === runId)
      ?? this.runs.find((entry) => entry.sessionId === sessionId);
    const now = Date.now();
    return [
      ...this.createAttachments(sessionId).map<SessionOutputRecord>((attachment) => ({
        id: attachment.attachmentId,
        kind: 'attachment',
        title: attachment.fileName,
        fileName: attachment.fileName,
        filePath: attachment.filePath,
        source: 'session attachment',
        mimeType: attachment.mimeType,
        sizeBytes: attachment.size,
        createdAt: attachment.createdAt,
        updatedAt: attachment.createdAt,
      })),
      ...(run ? [
        {
          id: `${run.runId}:report:markdown`,
          kind: 'report' as const,
          title: 'report.md',
          fileName: 'report.md',
          filePath: `H:\\rdx\\RDC-Agent\\.browser-preview\\sessions\\${sessionId}\\runs\\${run.runId}\\reports\\report.md`,
          source: 'run report',
          runId: run.runId,
          mimeType: 'text/markdown',
          sizeBytes: 4096,
          createdAt: now - 1000 * 60 * 2,
          updatedAt: now - 1000 * 60,
        },
        {
          id: `${run.runId}:artifact:preview-frame`,
          kind: 'artifact' as const,
          title: 'preview-frame.png',
          fileName: 'preview-frame.png',
          filePath: `H:\\rdx\\RDC-Agent\\.browser-preview\\sessions\\${sessionId}\\runs\\${run.runId}\\artifacts\\preview-frame.png`,
          source: 'artifact store',
          runId: run.runId,
          mimeType: 'image/png',
          sizeBytes: 32768,
          createdAt: now - 1000 * 60 * 3,
          updatedAt: now - 1000 * 60 * 3,
        },
      ] : []),
    ];
  }

  private async cancelActiveTurn(request?: ConversationCancelActiveTurnRequest) {
    const sessionId = request?.sessionId ?? this.currentSessionId ?? previewSessions[0].sessionId;
    const messages = this.conversations.get(sessionId) ?? [];
    const index = [...messages]
      .reverse()
      .findIndex((message) => (
        message.role === 'assistant'
        && typeof message.status === 'string'
        && ['draft', 'streaming'].includes(message.status)
      ));
    if (index < 0) {
      return { success: false, error: 'No active conversation turn.' };
    }
    const actualIndex = messages.length - 1 - index;
    const message = messages[actualIndex];
    if (!message) {
      return { success: false, error: 'No active conversation turn.' };
    }
    const stoppedMessage: ConversationMessage = {
      ...message,
      status: 'stopped',
      content: message.content || '当前请求已停止。',
      updatedAt: Date.now(),
      reasoningTrace: message.reasoningTrace
        ? { ...message.reasoningTrace, status: 'stopped', summary: '请求已停止。', updatedAt: Date.now() }
        : undefined,
    };
    const nextMessages = [...messages];
    nextMessages[actualIndex] = stoppedMessage;
    this.conversations.set(sessionId, nextMessages);
    this.emit('conversation:event', {
      type: 'message_completed',
      sessionId,
      turnId: stoppedMessage.turnId,
      message: stoppedMessage,
    } satisfies ConversationStreamEvent);
    return { success: true, cancelledTurnId: stoppedMessage.turnId };
  }

  private async sendConversationMessage(request: ConversationSendRequest): Promise<ConversationTurnResult> {
    const session = this.sessions.find((entry) => entry.sessionId === request.sessionId)
      ?? this.sessions.find((entry) => entry.projectId === request.projectId)
      ?? this.sessions[0]
      ?? null;
    const sessionId = session?.sessionId ?? null;
    const projectId = request.projectId ?? session?.projectId ?? this.projects[0]?.projectId ?? null;
    const run = sessionId ? this.runs.find((entry) => entry.sessionId === sessionId) ?? null : null;
    const turnId = createId('browser-preview-turn');
    const userMessage = createConversationMessage('user', request.message, {
      turnId,
      sessionId,
      projectId,
      runId: run?.runId ?? null,
      modeContext: request.mode,
      attachments: request.attachments?.map((attachment) => ({
        attachmentId: createId('browser-preview-attachment'),
        sessionId: sessionId ?? '',
        projectId: projectId ?? '',
        kind: 'file',
        fileName: attachment.fileName,
        filePath: attachment.sourcePath,
        mimeType: attachment.mimeType ?? 'application/octet-stream',
        size: attachment.size ?? 0,
        createdAt: Date.now(),
      })) ?? [],
    });
    const assistantDraftMessage = createConversationMessage(
      'assistant',
      'Browser preview mock received the message. Real Electron IPC is not available in this browser.',
      {
        turnId,
        sessionId,
        projectId,
        runId: run?.runId ?? null,
        modeContext: request.mode,
      },
    );

    if (sessionId) {
      const messages = this.conversations.get(sessionId) ?? [];
      this.conversations.set(sessionId, [...messages, userMessage, assistantDraftMessage]);
      this.emit('conversation:event', {
        type: 'message_completed',
        sessionId,
        turnId,
        message: assistantDraftMessage,
      } satisfies ConversationStreamEvent);
    }

    const mode: ConversationTurnResult['mode'] = run ? 'active_debug' : 'talk';
    return {
      session,
      mode,
      userMessage,
      assistantDraftMessage,
      executionTransition: { action: 'none' },
      runUpdate: run,
      debugPlanSummary: this.workflowState.debugPlan ?? null,
      pendingQuestions: this.workflowState.pendingQuestions ?? null,
      uiHints: {},
      errorViewModel: null,
    };
  }

  private async startWorkflow(request: DebugSessionStartRequest) {
    const runId = createId('browser-preview-run');
    const sessionId = request.sessionId ?? this.sessions.find((session) => session.projectId === request.projectId)?.sessionId ?? previewSessions[0].sessionId;
    const run: RunSummary = {
      runId,
      projectId: request.projectId,
      sessionId,
      caseId: createId('browser-preview-case'),
      mode: request.mode,
      goal: request.goal,
      captures: request.captures ?? [],
      startedAt: Date.now(),
      status: 'planning',
      lastStage: 'plan',
      backend: 'local',
    };
    this.runs = [run, ...this.runs];
    this.workflowState = {
      ...this.workflowState,
      runId,
      sessionId,
      currentStage: 'plan',
      lastUpdated: new Date().toISOString(),
    };
    return {
      success: true,
      caseId: run.caseId,
      runId,
      sessionId,
      currentStage: this.workflowState.currentStage,
      status: run.status,
      planStatus: this.workflowState.planReadiness,
      pendingQuestions: this.workflowState.pendingQuestions ?? null,
      debugPlanSummary: this.workflowState.debugPlan ?? null,
    };
  }

  private async updatePlanState(status: RunSummary['status'], runId: string | null) {
    const targetRunId = runId ?? this.workflowState.runId;
    this.runs = this.runs.map((run) => run.runId === targetRunId ? { ...run, status, lastStage: 'plan' } : run);
    this.workflowState = {
      ...this.workflowState,
      runId: targetRunId,
      approvalState: 'pending_user',
      pendingQuestions: null,
      lastUpdated: new Date().toISOString(),
    };
    return {
      success: true,
      runId: targetRunId,
      sessionId: this.workflowState.sessionId,
      debugPlan: this.workflowState.debugPlan ?? null,
      pendingQuestions: null as AskUserPrompt | null,
      approvalState: this.workflowState.approvalState,
    };
  }

  private createUsage(runId: string): RunContextUsageSummary {
    return {
      runId,
      providerId: 'browser-preview',
      modelId: 'browser-preview-model',
      inputTokens: 1200,
      outputTokens: 360,
      totalTokens: 1560,
      contextWindowTokens: 8192,
      usagePercent: 19,
      hasConfiguredContextWindow: true,
    };
  }

  private createAgentState(agentId: AgentRole): AgentState {
    return {
      agentId,
      status: agentId === 'rdc-debugger' ? 'waiting' : 'idle',
      lastActivity: new Date(NOW - 1000 * 60 * 3).toISOString(),
    };
  }

  private createToolCatalog(): ToolCatalog {
    return {
      schema_version: 'browser-preview',
      tools: [],
      namespaces: Object.fromEntries(toolNamespaces.map((namespace) => [
        namespace,
        {
          description: `${namespace} browser preview namespace`,
          groups: [],
        },
      ])) as unknown as ToolCatalog['namespaces'],
    };
  }

  private createToolRuntimeSummary(): ToolRuntimeSummary {
    return {
      runtime: {
        source: 'bundled',
        toolsRoot: 'H:\\rdx\\RDC-Agent\\resources\\tools',
        version: 'browser-preview',
        catalog: {
          path: 'H:\\rdx\\RDC-Agent\\resources\\tools\\catalog.json',
          exists: true,
          schemaVersion: 'browser-preview',
          generatedAt: new Date(NOW).toISOString(),
          toolCount: 24,
        },
      },
      cli: {
        available: true,
      },
      namespaces: [
        { namespace: 'rd.event.*', toolCount: 4, available: true },
        { namespace: 'rd.export.*', toolCount: 3, available: true },
        { namespace: 'rd.session.*', toolCount: 5, available: true },
      ],
      recommendedSpecialists: ['triage_agent', 'pixel_forensics_agent', 'curator_agent'],
    };
  }

  private createActionEvents(): ActionEvent[] {
    return [
      {
        schema_version: '1',
        event_id: 'browser-preview-event-1',
        turn_id: 'browser-preview-turn-1',
        ts_ms: NOW - 1000 * 60 * 4,
        run_id: this.workflowState.runId,
        session_id: this.workflowState.sessionId,
        agent_id: 'rdc-debugger',
        event_type: 'browser.preview.loaded',
        status: 'ok',
        duration_ms: 1,
        refs: [previewInput.filePath],
        payload: {
          mode: 'browser-preview',
        },
      },
    ];
  }

  private matchesLogScope(entry: RuntimeLogEntry, scope: RuntimeLogScope, sessionId?: string | null): boolean {
    if (scope === 'session') {
      return entry.scope === 'session' && Boolean(sessionId) && entry.sessionId === sessionId;
    }

    return true;
  }

  private async createTerminalTab(request?: TerminalCreateTabRequest) {
    const cwd = request?.cwd ?? this.settings.workspace.rootPath;
    const tab: TerminalTabRecord = {
      tabId: createId('browser-preview-terminal'),
      kind: 'shell',
      title: 'Browser Preview Shell',
      cwd,
      status: 'running',
      createdAt: Date.now(),
      sessionId: request?.sessionId ?? this.currentSessionId,
      projectId: request?.projectId ?? this.currentProjectId,
      runId: request?.runId ?? this.workflowState.runId,
    };
    this.terminalTabs = [...this.terminalTabs, tab];
    this.emit('terminal:tabsChanged', { tabs: this.terminalTabs });
    return { success: true, tab, tabs: this.terminalTabs };
  }

  private async closeTerminalTab(tabId: string) {
    this.terminalTabs = this.terminalTabs.filter((tab) => tab.tabId !== tabId);
    this.emit('terminal:exit', { tabId, exitCode: 0 } satisfies TerminalExitEvent);
    this.emit('terminal:tabsChanged', { tabs: this.terminalTabs });
    return { success: true, tabs: this.terminalTabs };
  }

  private async openHumanPreview(sessionId?: string) {
    const contextSnapshot: ContextSnapshot = {
      ...(this.contextSnapshot ?? createContextSnapshot()),
      humanPreview: {
        status: 'open',
        sessionId: sessionId ?? this.contextSnapshot?.sessionId ?? this.workflowState.sessionId,
        boundEventId: 6152,
        updatedAt: Date.now(),
      },
    };
    this.contextSnapshot = contextSnapshot;
    this.emit('context:changed', contextSnapshot);
    return { success: true, contextSnapshot };
  }

  private async closeHumanPreview() {
    const contextSnapshot: ContextSnapshot = {
      ...(this.contextSnapshot ?? createContextSnapshot()),
      humanPreview: {
        status: 'closed',
        updatedAt: Date.now(),
      },
    };
    this.contextSnapshot = contextSnapshot;
    this.emit('context:changed', contextSnapshot);
    return { success: true, contextSnapshot };
  }

  private async openProjectInput(request: Omit<OpenProjectInputRequest, 'replayDevice'> & { replayDeviceId: string }) {
    const project = this.projects.find((entry) => entry.projectId === request.projectId);
    const input = project?.inputs.find((entry) => entry.inputId === request.inputId);
    const device = this.devices.find((entry) => entry.id === request.replayDeviceId) ?? this.devices[0];
    if (!project || !input || !device) {
      return { success: false, error: 'Capture input not found' };
    }

    const openedCapture: OpenedCaptureState = {
      projectId: project.projectId,
      inputId: input.inputId,
      filePath: input.filePath,
      captureId: input.inputId,
      captureFileId: input.inputId,
      sessionId: this.workflowState.sessionId,
      contextId: 'browser-preview-context',
      replaySessionId: 'browser-preview-replay',
      backend: device.type === 'android' ? 'remote' : 'local',
      deviceId: device.id,
      deviceLabel: device.label,
      status: 'open',
      openedAt: Date.now(),
      preview: null,
    };
    const contextSnapshot: ContextSnapshot = {
      contextId: openedCapture.contextId,
      sessionId: openedCapture.sessionId,
      backend: openedCapture.backend,
      runtimeOwner: 'browser-preview',
      ownerLeaseId: 'browser-preview-lease',
      captureDescriptors: [
        {
          id: input.inputId,
          filePath: input.filePath,
          captureFileId: input.inputId,
          role: 'primary',
          backendHint: openedCapture.backend,
          status: 'open',
          sessionId: openedCapture.sessionId,
          replaySessionId: openedCapture.replaySessionId,
          contextId: openedCapture.contextId,
        },
      ],
      activeCapture: input.inputId,
      deviceLabel: device.label,
      humanPreview: this.contextSnapshot?.humanPreview ?? {
        status: 'closed',
        updatedAt: Date.now(),
      },
    };
    this.openedCapture = openedCapture;
    this.contextSnapshot = contextSnapshot;
    this.emit('capture:openedStateChanged', openedCapture);
    this.emit('context:changed', contextSnapshot);
    this.emit('device:statusChanged', {
      device,
      devices: this.devices,
    } satisfies ReplayDeviceStatusChangedPayload);
    return {
      success: true,
      openedCapture,
      contextSnapshot,
    };
  }
}

export const installBrowserElectronApiFallback = (): void => {
  if (typeof window === 'undefined') {
    return;
  }

  const target = window as BrowserFallbackWindow;
  if (window.electronAPI || target[FALLBACK_MARKER]) {
    return;
  }

  const fallback = new BrowserElectronApiFallback();
  window.electronAPI = fallback.api;
  target[FALLBACK_MARKER] = true;
};

export const isBrowserElectronApiFallback = (): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }

  return Boolean((window as BrowserFallbackWindow)[FALLBACK_MARKER]);
};

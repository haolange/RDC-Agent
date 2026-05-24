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
  WorkflowState,
} from '@shared/types/workflow';
import type {
  AgentWorkstreamPresentation,
  AgentWorkstreamSession,
  TaskWorkstream,
  UserRequest,
  WorkstreamRevisionResult,
} from '@shared/types/workstream';
import type { ElectronAPI } from '@shared/types/electron';
import {
  LEFT_SIDEBAR_DEFAULT_WIDTH,
  RIGHT_PANEL_DEFAULT_WIDTH,
  TERMINAL_DEFAULT_HEIGHT,
} from '@shared/constants/layout';
import { createBuiltinProviderEntries } from '@shared/constants/llm';
import {
  type BrowserPreviewScenario,
  DEFAULT_BROWSER_PREVIEW_SCENARIO_ID,
  createMinimalBrowserPreviewScenario,
  loadBrowserPreviewScenarioSync,
} from './BrowserPreviewScenario';

const FALLBACK_MARKER = '__RDC_AGENT_BROWSER_ELECTRON_API_FALLBACK__';
const NOW = Date.now();
const BROWSER_PREVIEW_ROOT = '.browser-preview';

const previewPath = (...segments: string[]): string => [BROWSER_PREVIEW_ROOT, ...segments].join('/');
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

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
  const providers = createBuiltinProviderEntries().map((provider) => (
    provider.id === 'openrouter'
      ? {
          ...provider,
          enabled: true,
          hasStoredSecret: true,
          status: 'verified' as const,
          models: [
            {
              id: 'browser-preview-model',
              label: 'Browser Preview Model',
              enabled: true,
              contextWindowTokens: 8192,
            },
          ],
          lastTestedAt: new Date(NOW).toISOString(),
          lastModelRefreshAt: new Date(NOW).toISOString(),
          isConfigured: true,
        }
      : provider
  ));
  const agentRoutes: LlmAgentRoute[] = agentRoles.map((agentId) => ({
    agentId,
    providerId: 'openrouter',
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
      rootPath: previewPath(),
    },
    llm: {
      providers,
      agentRoutes,
    },
    configuration: {
      activeModeProfileId: 'debugger.default',
      availableModeProfiles: [],
      diagnostics: [],
      lastMigrationSummary: [],
    },
    paths: {
      workspaceRoot: previewPath(),
      defaultWorkspaceRoot: previewPath(),
      settingsPath: previewPath('settings.json'),
      logsPath: previewPath('logs'),
      logPath: previewPath('logs', 'rdc-agent.log'),
      projectsPath: previewPath('projects'),
      knowledgePath: previewPath('knowledge'),
      migrationOrphansPath: previewPath('migration-orphans'),
      profilesPath: previewPath('profiles'),
      policiesPath: previewPath('policies'),
      secretsPath: previewPath('secrets'),
      migrationReportsPath: previewPath('migration-reports'),
    },
  };
};

const createConversationMessage = (
  role: ConversationMessage['role'],
  content: string,
  defaults: Pick<ConversationMessage, 'sessionId' | 'projectId'> & {
    runId?: string | null;
    modeContext?: ConversationMessage['modeContext'];
  },
  patch: Partial<ConversationMessage> = {},
): ConversationMessage => ({
  id: createId(`browser-preview-${role}`),
  turnId: patch.turnId ?? 'browser-preview-turn-1',
  sessionId: patch.sessionId ?? defaults.sessionId,
  projectId: patch.projectId ?? defaults.projectId,
  runId: patch.runId ?? defaults.runId ?? null,
  modeContext: patch.modeContext ?? defaults.modeContext ?? 'debugger',
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
  private scenarioId = DEFAULT_BROWSER_PREVIEW_SCENARIO_ID;
  private settings = createSettings();
  private projects: ProjectRecord[] = [];
  private sessions: SessionRecord[] = [];
  private runs: RunSummary[] = [];
  private currentProjectId: string | null = null;
  private currentSessionId: string | null = null;
  private workflowState!: WorkflowState;
  private openedCapture: OpenedCaptureState | null = null;
  private contextSnapshot: ContextSnapshot | null = null;
  private devices: ReplayDeviceEntry[] = [];
  private terminalTabs: TerminalTabRecord[] = [];
  private runtimeLogs: RuntimeLogEntry[] = [];
  private conversations = new Map<string, ConversationMessage[]>();
  private attachments = new Map<string, SessionAttachmentRecord[]>();
  private outputs = new Map<string, SessionOutputRecord[]>();
  private actionEvents: ActionEvent[] = [];
  private workstreamSession: AgentWorkstreamSession | null = null;
  private workstreamPresentation: AgentWorkstreamPresentation | null = null;
  private usage: RunContextUsageSummary | null = null;
  private listeners = new Map<string, Set<EventCallback>>();

  constructor() {
    const scenario = loadBrowserPreviewScenarioSync(NOW);
    this.applyScenario(scenario);
  }

  private applyScenario(scenario: BrowserPreviewScenario): void {
    const fallback = createMinimalBrowserPreviewScenario(NOW);
    this.scenarioId = scenario.scenarioId ?? fallback.scenarioId;
    this.settings = createSettings();
    this.projects = clone(scenario.projects ?? fallback.projects);
    this.sessions = clone(scenario.sessions ?? fallback.sessions);
    this.runs = clone(scenario.runs ?? fallback.runs);
    this.currentProjectId = scenario.currentProjectId ?? fallback.currentProjectId;
    this.currentSessionId = scenario.currentSessionId ?? fallback.currentSessionId;
    this.workflowState = clone(scenario.workflowState ?? fallback.workflowState);
    this.openedCapture = clone(scenario.openedCapture ?? fallback.openedCapture);
    this.contextSnapshot = clone(scenario.contextSnapshot ?? fallback.contextSnapshot);
    this.devices = clone(scenario.devices ?? fallback.devices);
    this.runtimeLogs = clone(scenario.runtimeLogs ?? fallback.runtimeLogs);
    this.conversations = new Map(Object.entries(clone(scenario.conversations ?? fallback.conversations)));
    this.attachments = new Map(Object.entries(clone(scenario.attachments ?? {})));
    this.outputs = new Map(Object.entries(clone(scenario.outputs ?? {})));
    this.actionEvents = clone(scenario.actionEvents ?? []);
    this.workstreamSession = scenario.workstreamSession ? clone(scenario.workstreamSession) : this.createWorkstreamSession();
    this.workstreamPresentation = scenario.workstreamPresentation
      ? clone(scenario.workstreamPresentation)
      : this.createWorkstreamPresentation(this.workstreamSession);
    this.usage = scenario.usage ? clone(scenario.usage) : null;
  }

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
        testMode: false,
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
        const session = this.workstreamSession ?? this.createWorkstreamSession();
        const now = new Date().toISOString();
        this.workstreamSession = {
          ...session,
          latestAcceptedPlanId: session.latestDisplayedPlanId,
          workstreams: [
            ...session.workstreams.map((workstream) => workstream.id === `ws-${runId}-plan`
              ? {
                  ...workstream,
                  status: 'completed' as const,
                  density: 'compact' as const,
                  planStatus: 'accepted' as const,
                  processEvents: [
                    ...workstream.processEvents,
                    {
                      kind: 'user.confirmed' as const,
                      id: 'browser-preview-confirmation',
                      workstreamId: workstream.id,
                      planId: session.latestDisplayedPlanId ?? 'browser-preview-plan',
                      createdAt: now,
                      label: '同意执行',
                    },
                  ],
                }
              : workstream),
            {
              id: `ws-${runId}-execution`,
              sessionId: session.sessionId,
              branchId: session.activeBranchId,
              type: 'debugger',
              status: 'running',
              density: 'expanded',
              resultKind: 'report',
              startedAt: now,
              processEvents: [
                {
                  kind: 'subagent',
                  id: 'browser-preview-subagent',
                  workstreamId: `ws-${runId}-execution`,
                  createdAt: now,
                  status: 'running',
                  label: 'pixel_forensics_agent',
                  summary: 'Inspecting highlighted render target.',
                },
              ],
            },
          ],
          progress: [
            ...session.progress.map((task) => task.id === 'browser-preview-progress-plan' ? { ...task, status: 'completed' as const, completedAt: now, updatedAt: now } : task),
            {
              id: 'browser-preview-progress-execution',
              sessionId: session.sessionId,
              workstreamId: `ws-${runId}-execution`,
              branchId: session.activeBranchId,
              title: 'Execute approved plan',
              status: 'running',
              order: 2,
              createdAt: now,
              updatedAt: now,
              source: 'runtime',
            },
          ],
          updatedAt: now,
        };
        this.workstreamPresentation = this.createWorkstreamPresentation(this.workstreamSession);
        this.emit('workflow:workstreamChanged', {
          sessionId: this.workstreamSession.sessionId,
          presentation: this.workstreamPresentation,
        });
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
      getWorkstreamSession: async (_sessionId) => ({
        success: true,
        session: this.workstreamSession ?? this.createWorkstreamSession(),
        presentation: this.workstreamPresentation ?? this.createWorkstreamPresentation(this.workstreamSession ?? this.createWorkstreamSession()),
      }),
      requestPlanRevision: async (runId, revisionText) => this.requestPlanRevision(runId, revisionText),
      switchWorkstreamBranch: async (_sessionId, branchId) => {
        if (this.workstreamSession) {
          this.workstreamSession = {
            ...this.workstreamSession,
            activeBranchId: branchId,
            branches: this.workstreamSession.branches.map((group) => ({
              ...group,
              activeBranchId: group.branches.some((branch) => branch.id === branchId) ? branchId : group.activeBranchId,
            })),
            updatedAt: new Date().toISOString(),
          };
          this.workstreamPresentation = this.createWorkstreamPresentation(this.workstreamSession);
          this.emit('workflow:workstreamChanged', {
            sessionId: this.workstreamSession.sessionId,
            presentation: this.workstreamPresentation,
          });
        }
        return {
          success: true,
          activeBranchId: this.workstreamSession?.activeBranchId ?? branchId,
          session: this.workstreamSession ?? undefined,
          presentation: this.workstreamPresentation ?? undefined,
        };
      },
      exportWorkstreamSession: async (sessionId) => ({
        success: true,
        sessionId,
        summaryPath: previewPath('sessions', sessionId, 'exports', 'agent-workstream-summary.json'),
        rawTracePath: previewPath('sessions', sessionId, 'exports', 'agent-workstream-raw-trace.jsonl'),
        bundlePath: previewPath('sessions', sessionId, 'exports', 'agent-workstream-summary.json'),
      }),
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
      testProviderDraft: async (request) => ({
        success: true,
        provider: this.settings.llm.providers.find((provider) => provider.id === request.providerId),
        models: [{ id: 'browser-preview-model', label: 'Browser Preview Model', enabled: true }],
      }),
      connectProvider: async (request) => {
        const provider = this.settings.llm.providers.find((entry) => entry.id === request.providerId);
        if (!provider) {
          return { success: false, models: [], error: 'Unknown provider' };
        }
        const models = [{ id: 'browser-preview-model', label: 'Browser Preview Model', enabled: true }];
        this.settings = this.applySettingsPatch(this.settings, {
          llm: {
            providers: this.settings.llm.providers.map((entry) => entry.id === request.providerId
              ? {
                  ...entry,
                  enabled: true,
                  hasStoredSecret: entry.authMode !== 'local',
                  baseUrl: entry.baseUrlEditable ? request.baseUrl || entry.baseUrl : entry.baseUrl,
                  status: 'verified',
                  models,
                  lastTestedAt: new Date().toISOString(),
                  lastModelRefreshAt: new Date().toISOString(),
                  isConfigured: true,
                }
              : entry),
          },
        });
        return {
          success: true,
          provider: this.settings.llm.providers.find((entry) => entry.id === request.providerId),
          models,
        };
      },
      refreshProviderModels: async (providerId) => this.api.llm.connectProvider({ providerId }),
      disconnectProvider: async (providerId) => {
        this.settings = this.applySettingsPatch(this.settings, {
          llm: {
            providers: this.settings.llm.providers.map((entry) => entry.id === providerId
              ? {
                  ...entry,
                  enabled: false,
                  hasStoredSecret: entry.authMode === 'local',
                  status: entry.status === 'unavailable' ? 'unavailable' : 'unconfigured',
                  models: [],
                  isConfigured: false,
                }
              : entry),
          },
        });
        return {
          success: true,
          provider: this.settings.llm.providers.find((entry) => entry.id === providerId),
          models: [],
        };
      },
      startProviderAccountLogin: async (providerId) => ({
        providerId,
        state: providerId === 'github-copilot' ? 'pending' : 'pending',
        available: true,
        connected: false,
        message: 'Browser preview authorization flow started.',
        authUrl: providerId === 'github-copilot' ? undefined : 'https://example.com/oauth',
        verificationUri: providerId === 'github-copilot' ? 'https://github.com/login/device' : undefined,
        userCode: providerId === 'github-copilot' ? 'ABCD-1234' : undefined,
        requiresCodeInput: providerId === 'claude-account',
      }),
      getProviderAccountStatus: async (providerId) => ({
        providerId,
        state: 'signed-out',
        available: true,
        connected: false,
        message: 'Not connected',
      }),
      finishProviderAccountLogin: async (request) => {
        const models = [{ id: 'browser-preview-oauth-model', label: 'Browser Preview OAuth Model', enabled: true }];
        this.settings = this.applySettingsPatch(this.settings, {
          llm: {
            providers: this.settings.llm.providers.map((entry) => entry.id === request.providerId
              ? {
                  ...entry,
                  enabled: true,
                  hasStoredSecret: true,
                  status: 'verified',
                  models,
                  accountLabel: entry.label,
                  lastTestedAt: new Date().toISOString(),
                  lastModelRefreshAt: new Date().toISOString(),
                  isConfigured: true,
                }
              : entry),
          },
        });
        return {
          providerId: request.providerId,
          state: 'connected',
          available: true,
          connected: true,
          message: 'Connected',
          accountLabel: 'Browser Preview Account',
          models,
        };
      },
      logoutProviderAccount: async (providerId) => this.api.llm.getProviderAccountStatus(providerId),
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
      get: async () => this.contextSnapshot ?? this.createContextSnapshotFallback(),
      openHumanPreview: async (request) => this.openHumanPreview(request?.sessionId),
      closeHumanPreview: async () => this.closeHumanPreview(),
    },

    events: {
      onWorkflowStateChanged: (callback) => this.on('workflow:stateChanged', callback as EventCallback),
      onWorkflowStageChanged: (callback) => this.on('workflow:stageChanged', callback as EventCallback),
      onRunStatusChanged: (callback) => this.on('workflow:runStatusChanged', callback as EventCallback),
      onRunUsageChanged: (callback) => this.on('workflow:runUsageChanged', callback as EventCallback),
      onWorkstreamChanged: (callback) => this.on('workflow:workstreamChanged', callback as EventCallback),
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
      projectId,
      name,
      rootPath,
      slug: projectId,
      resourcePath: `${rootPath}/resources`,
      knowledgePath: `${rootPath}/knowledge`,
      inputsPath: `${rootPath}/inputs`,
      inputs: [],
      inputsUpdatedAt: Date.now(),
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
      projectId: session?.projectId ?? this.currentProjectId ?? this.projects[0]?.projectId ?? 'browser-preview-project',
      kind: 'file',
      fileName: filePath.split(/[\\/]/).filter(Boolean).pop() || 'attachment.txt',
      filePath,
      mimeType: 'application/octet-stream',
      size: 1024,
      createdAt: Date.now(),
    };
  }

  private createAttachments(sessionId: string): SessionAttachmentRecord[] {
    return this.attachments.get(sessionId) ?? [
      this.createAttachment(sessionId, previewPath('notes', 'preview-note.md')),
    ];
  }

  private createOutputs(sessionId: string, runId?: string): SessionOutputRecord[] {
    const scenarioOutputs = this.outputs.get(sessionId);
    if (scenarioOutputs) {
      return runId ? scenarioOutputs.filter((output) => !output.runId || output.runId === runId) : scenarioOutputs;
    }

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
          filePath: previewPath('sessions', sessionId, 'runs', run.runId, 'reports', 'report.md'),
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
          filePath: previewPath('sessions', sessionId, 'runs', run.runId, 'artifacts', 'preview-frame.png'),
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
    const sessionId = request?.sessionId ?? this.currentSessionId ?? this.sessions[0]?.sessionId ?? 'browser-preview-session';
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
    const messageDefaults = {
      sessionId,
      projectId,
      runId: run?.runId ?? null,
      modeContext: request.mode,
    };
    const userMessage = createConversationMessage('user', request.message, messageDefaults, {
      turnId,
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
      messageDefaults,
      {
        turnId,
      },
    );

    if (sessionId) {
      const messages = this.conversations.get(sessionId) ?? [];
      this.conversations.set(sessionId, [...messages, userMessage, assistantDraftMessage]);
      this.upsertConversationWorkstream(sessionId, userMessage, assistantDraftMessage);
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
      workstreamPresentation: this.workstreamPresentation,
      uiHints: {},
      errorViewModel: null,
    };
  }

  private upsertConversationWorkstream(
    sessionId: string,
    userMessage: ConversationMessage,
    assistantMessage: ConversationMessage,
  ): void {
    const baseSession = this.workstreamSession?.sessionId === sessionId
      ? this.workstreamSession
      : this.createWorkstreamSession();
    const branchId = baseSession.activeBranchId || 'branch-main';
    const now = new Date().toISOString();
    const workstreamId = `ws-ask-${userMessage.turnId}`;
    const requestId = `request-ask-${userMessage.turnId}`;
    const revisionId = `revision-ask-${userMessage.turnId}`;
    const isFailed = assistantMessage.status === 'error';
    const isRunning = assistantMessage.status === 'draft' || assistantMessage.status === 'streaming';
    const workstream: TaskWorkstream = {
      id: workstreamId,
      sessionId,
      branchId,
      type: 'ask',
      status: isFailed ? 'failed' : isRunning ? 'running' : 'completed',
      density: isRunning ? 'expanded' : 'compact',
      resultKind: isFailed ? 'failure' : isRunning ? undefined : 'answer',
      startedAt: new Date(userMessage.createdAt).toISOString(),
      completedAt: isRunning ? undefined : new Date(assistantMessage.updatedAt ?? assistantMessage.createdAt).toISOString(),
      processEvents: isRunning ? [{
        kind: 'agent.text',
        id: `agent-text-${assistantMessage.id}`,
        workstreamId,
        createdAt: new Date(assistantMessage.createdAt).toISOString(),
        text: assistantMessage.content || '正在生成回复。',
      }] : [],
      result: isRunning ? undefined : {
        id: isFailed ? `${workstreamId}-failure-result` : `${workstreamId}-answer-result`,
        workstreamId,
        kind: isFailed ? 'failure' : 'answer',
        status: isFailed ? 'failed' : 'completed',
        title: isFailed ? 'Ask Failed' : 'Ask Answer',
        sections: isFailed
          ? [
              {
                id: 'error',
                title: '失败原因',
                body: assistantMessage.content || assistantMessage.diagnostic?.userMessage || '回复生成失败。',
                severity: 'error',
              },
              ...(assistantMessage.diagnostic ? [{
                id: 'diagnostic',
                title: '诊断',
                body: [
                  assistantMessage.diagnostic.code,
                  assistantMessage.diagnostic.providerId && assistantMessage.diagnostic.modelId
                    ? `${assistantMessage.diagnostic.providerId}/${assistantMessage.diagnostic.modelId}`
                    : assistantMessage.diagnostic.providerId,
                  assistantMessage.diagnostic.technicalMessage,
                ].filter(Boolean).join('\n'),
                severity: assistantMessage.diagnostic.severity === 'error' ? 'error' as const : 'warning' as const,
              }] : []),
            ]
          : [{ id: 'answer', title: '回答', body: assistantMessage.content || 'Browser preview mock received the message.' }],
        artifactIds: [],
        createdAt: new Date(assistantMessage.updatedAt ?? assistantMessage.createdAt).toISOString(),
      },
    };
    const request: UserRequest = {
      id: requestId,
      sessionId,
      rootRevisionId: revisionId,
      activeRevisionId: revisionId,
      revisions: [{
        id: revisionId,
        requestId,
        branchId,
        prompt: userMessage.content || 'Ask',
        createdAt: new Date(userMessage.createdAt).toISOString(),
        resultingWorkstreamIds: [workstreamId],
      }],
    };

    this.workstreamSession = {
      ...baseSession,
      userRequests: [
        ...baseSession.userRequests.filter((entry) => entry.id !== requestId),
        request,
      ],
      workstreams: [
        ...baseSession.workstreams.filter((entry) => entry.id !== workstreamId),
        workstream,
      ],
      progress: baseSession.progress,
      artifacts: baseSession.artifacts,
      context: baseSession.context,
      updatedAt: now,
    };
    this.workstreamPresentation = this.createWorkstreamPresentation(this.workstreamSession);
    this.emit('workflow:workstreamChanged', { sessionId, presentation: this.workstreamPresentation });
  }

  private async startWorkflow(request: DebugSessionStartRequest) {
    const runId = createId('browser-preview-run');
    const sessionId = request.sessionId
      ?? this.sessions.find((session) => session.projectId === request.projectId)?.sessionId
      ?? this.sessions[0]?.sessionId
      ?? 'browser-preview-session';
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

  private createWorkstreamSession(): AgentWorkstreamSession {
    const sessionId = this.currentSessionId ?? this.workflowState.sessionId;
    const run = this.runs.find((entry) => entry.sessionId === sessionId) ?? this.runs[0];
    const runId = run?.runId ?? this.workflowState.runId;
    const branchId = 'branch-main';
    const planId = this.workflowState.debugPlan?.planId ?? 'browser-preview-plan';
    const now = new Date().toISOString();
    const session: AgentWorkstreamSession = {
      sessionId,
      activeBranchId: branchId,
      latestDisplayedPlanId: planId,
      latestAcceptedPlanId: this.workflowState.approvalState === 'approved' ? planId : undefined,
      userRequests: [
        {
          id: `request-${runId}`,
          sessionId,
          rootRevisionId: `revision-${runId}`,
          activeRevisionId: `revision-${runId}`,
          revisions: [
            {
              id: `revision-${runId}`,
              requestId: `request-${runId}`,
              branchId,
              prompt: run?.goal ?? 'Browser Preview Agent Workstream',
              createdAt: now,
              resultingWorkstreamIds: [`ws-${runId}-plan`],
            },
          ],
        },
      ],
      branches: [
        {
          id: `branch-group-request-${runId}`,
          rootRequestId: `request-${runId}`,
          activeBranchId: branchId,
          branches: [
            {
              id: branchId,
              revisionId: `revision-${runId}`,
              status: 'active',
              workstreamIds: [`ws-${runId}-plan`, `ws-${runId}-execution`],
            },
          ],
        },
      ],
      workstreams: [
        {
          id: `ws-${runId}-plan`,
          sessionId,
          branchId,
          type: run?.mode ?? 'debugger',
          status: this.workflowState.approvalState === 'approved' ? 'completed' : 'awaiting_approval',
          density: this.workflowState.approvalState === 'approved' ? 'compact' : 'expanded',
          resultKind: 'plan',
          startedAt: now,
          processEvents: [
            {
              kind: 'agent.text',
              id: 'browser-preview-thinking-plan',
              workstreamId: `ws-${runId}-plan`,
              createdAt: now,
              text: 'Browser Preview 使用稳定 scenario 展示 Agent Workstream；真实 IPC/ToolBridge 不在此处执行。',
            },
            {
              kind: 'tool',
              id: 'browser-preview-tool-plan',
              workstreamId: `ws-${runId}-plan`,
              createdAt: now,
              completedAt: now,
              status: 'done',
              title: 'Inspect opened capture context',
              summary: '确认当前 project 已有 opened capture。',
              target: this.openedCapture?.filePath,
              rawTraceRef: 'raw-browser-preview-tool-plan',
            },
          ],
          result: {
            id: `ws-${runId}-plan-result`,
            workstreamId: `ws-${runId}-plan`,
            kind: 'plan',
            status: this.workflowState.approvalState === 'approved' ? 'accepted' : 'awaiting_approval',
            title: this.workflowState.debugPlan?.presentation?.title ?? 'Browser Preview Debug Plan',
            sections: [
              { id: 'goal', title: '目标', body: run?.goal ?? 'Preview Agent Workstream UI.' },
              { id: 'route', title: '执行路线', body: 'Plan approval 后创建 Execution Workstream，并在右侧累积 Progress / Artifacts / Context。' },
              { id: 'acceptance', title: '验收标准', body: '消息流不再直接投影 raw trace；raw 仅在展开详情和导出中出现。' },
            ],
            artifactIds: ['browser-preview-plan-artifact'],
            createdAt: now,
          },
          planId,
          planStatus: this.workflowState.approvalState === 'approved' ? 'accepted' : 'awaiting_approval',
        },
      ],
      progress: [
        {
          id: 'browser-preview-progress-plan',
          sessionId,
          workstreamId: `ws-${runId}-plan`,
          branchId,
          title: 'Approve structured plan',
          status: this.workflowState.approvalState === 'approved' ? 'completed' : 'running',
          order: 1,
          createdAt: now,
          updatedAt: now,
          source: 'plan',
        },
      ],
      artifacts: [
        {
          id: 'browser-preview-plan-artifact',
          sessionId,
          workstreamId: `ws-${runId}-plan`,
          branchId,
          type: 'plan',
          status: 'ready',
          displayName: 'plan.md',
          taskTitle: 'Plan Task',
          path: previewPath('sessions', sessionId, 'runs', runId, 'reports', 'plan.md'),
          rawRef: 'raw-browser-preview-plan',
          createdAt: now,
          updatedAt: now,
        },
      ],
      context: [
        {
          id: 'browser-preview-context-capture',
          sessionId,
          workstreamId: `ws-${runId}-plan`,
          branchId,
          kind: 'capture',
          label: this.openedCapture?.filePath.split(/[\\/]/).pop() ?? 'minimal-preview.rdc',
          summary: this.openedCapture?.filePath,
          importance: 'decisive',
          firstObservedAt: now,
          lastObservedAt: now,
        },
        {
          id: 'browser-preview-context-capability',
          sessionId,
          workstreamId: `ws-${runId}-plan`,
          branchId,
          kind: 'capability',
          label: 'RDX ToolBridge',
          summary: 'Browser Preview 只显示 capability 索引，不执行真实 rdx.bat。',
          importance: 'important',
          firstObservedAt: now,
          lastObservedAt: now,
        },
      ],
      rawAuditRefs: [
        {
          id: 'raw-browser-preview-tool-plan',
          label: 'tool_execution',
          runId,
          sessionId,
          ref: 'browser-preview',
        },
      ],
      updatedAt: now,
    };
    return this.applyWorkstreamScenarioVariant(session, runId, planId, now);
  }

  private applyWorkstreamScenarioVariant(
    session: AgentWorkstreamSession,
    runId: string,
    planId: string,
    now: string,
  ): AgentWorkstreamSession {
    const planWorkstreamId = `ws-${runId}-plan`;
    const executionWorkstreamId = `ws-${runId}-execution`;
    const basePlan = session.workstreams.find((workstream) => workstream.id === planWorkstreamId) ?? session.workstreams[0];
    if (!basePlan) {
      return session;
    }

    const withAcceptedPlan = (nextSession: AgentWorkstreamSession, includeRunningExecution: boolean): AgentWorkstreamSession => {
      const confirmation = {
        kind: 'user.confirmed' as const,
        id: 'browser-preview-user-confirmed',
        workstreamId: planWorkstreamId,
        planId,
        createdAt: now,
        label: '同意执行',
      };
      const plan = {
        ...basePlan,
        status: 'completed' as const,
        density: 'compact' as const,
        completedAt: now,
        planStatus: 'accepted' as const,
        processEvents: [...basePlan.processEvents, confirmation],
        result: basePlan.result ? { ...basePlan.result, status: 'accepted' as const } : basePlan.result,
      };
      const execution = {
        id: executionWorkstreamId,
        sessionId: session.sessionId,
        branchId: session.activeBranchId,
        type: 'debugger' as const,
        status: includeRunningExecution ? 'running' as const : 'completed' as const,
        density: includeRunningExecution ? 'expanded' as const : 'compact' as const,
        resultKind: 'report' as const,
        startedAt: now,
        completedAt: includeRunningExecution ? undefined : now,
        processEvents: [
          {
            kind: 'agent.text' as const,
            id: 'browser-preview-execution-thinking-a',
            workstreamId: executionWorkstreamId,
            createdAt: now,
            text: '开始执行已接受的计划。',
          },
          {
            kind: 'agent.text' as const,
            id: 'browser-preview-execution-thinking-b',
            workstreamId: executionWorkstreamId,
            createdAt: now,
            text: '连续 agent text 会在 presentation 中合并为一个 Thinking Bubble。',
          },
          {
            kind: 'tool' as const,
            id: 'browser-preview-tool-execution',
            workstreamId: executionWorkstreamId,
            createdAt: now,
            completedAt: includeRunningExecution ? undefined : now,
            status: includeRunningExecution ? 'running' as const : 'done' as const,
            title: 'Verify render target evidence',
            summary: '验证执行计划中的 RenderDoc 证据。',
            rawTraceRef: 'raw-browser-preview-tool-execution',
          },
        ],
        result: includeRunningExecution ? undefined : {
          id: `${executionWorkstreamId}-result`,
          workstreamId: executionWorkstreamId,
          kind: 'report' as const,
          status: 'ready' as const,
          title: 'Execution Report',
          sections: [
            { id: 'summary', title: '结论', body: '执行已完成，报告和产物进入 Artifacts。' },
            { id: 'evidence', title: '证据', body: 'Tool Row raw ref 仅作为 audit 入口保留。' },
          ],
          artifactIds: ['browser-preview-report-artifact'],
          createdAt: now,
        },
      };
      return {
        ...nextSession,
        latestAcceptedPlanId: planId,
        workstreams: [plan, execution],
        progress: [
          ...nextSession.progress.map((task) => task.workstreamId === planWorkstreamId ? { ...task, status: 'completed' as const, completedAt: now, updatedAt: now } : task),
          {
            id: 'browser-preview-progress-execution',
            sessionId: session.sessionId,
            workstreamId: executionWorkstreamId,
            branchId: session.activeBranchId,
            title: includeRunningExecution ? 'Execute approved plan' : 'Publish execution report',
            status: includeRunningExecution ? 'running' as const : 'completed' as const,
            order: 2,
            createdAt: now,
            updatedAt: now,
            completedAt: includeRunningExecution ? undefined : now,
            source: 'runtime' as const,
          },
        ],
        artifacts: includeRunningExecution ? nextSession.artifacts : [
          ...nextSession.artifacts,
          {
            id: 'browser-preview-report-artifact',
            sessionId: session.sessionId,
            workstreamId: executionWorkstreamId,
            branchId: session.activeBranchId,
            type: 'report' as const,
            status: 'ready' as const,
            displayName: 'report.md',
            taskTitle: 'Execution Task',
            path: previewPath('sessions', session.sessionId, 'runs', runId, 'reports', 'report.md'),
            rawRef: 'raw-browser-preview-report',
            createdAt: now,
            updatedAt: now,
          },
        ],
        rawAuditRefs: [
          ...nextSession.rawAuditRefs,
          { id: 'raw-browser-preview-tool-execution', label: 'tool_execution', runId, sessionId: session.sessionId, ref: 'browser-preview' },
        ],
        updatedAt: now,
      };
    };

    switch (this.scenarioId) {
      case 'ask-task':
        return {
          ...session,
          latestDisplayedPlanId: undefined,
          latestAcceptedPlanId: undefined,
          workstreams: [{
            ...basePlan,
            type: 'ask',
            status: 'completed',
            density: 'compact',
            resultKind: 'answer',
            planId: undefined,
            planStatus: undefined,
            result: {
              id: 'browser-preview-ask-result',
              workstreamId: basePlan.id,
              kind: 'answer',
              status: 'ready',
              title: 'Ask Answer',
              sections: [{ id: 'answer', title: '回答', body: 'Ask 只产生轻量回答，不创建正式 run，也不暴露 RenderDoc 工具。' }],
              artifactIds: [],
              createdAt: now,
            },
          }],
          artifacts: [],
        };
      case 'execute-accepted-plan':
        return withAcceptedPlan(session, true);
      case 'execution-report':
        return withAcceptedPlan(session, false);
      case 'revision-request': {
        const branchId = 'branch-revision';
        const revisionId = `revision-${runId}-revision`;
        const revisionWorkstreamId = `ws-${runId}-revision`;
        return {
          ...session,
          activeBranchId: branchId,
          latestDisplayedPlanId: `plan-${revisionId}`,
          latestAcceptedPlanId: undefined,
          userRequests: session.userRequests.map((request) => ({
            ...request,
            activeRevisionId: revisionId,
            revisions: [
              ...request.revisions,
              {
                id: revisionId,
                requestId: request.id,
                branchId,
                parentRevisionId: request.activeRevisionId,
                prompt: '请缩小计划范围，先验证当前 opened capture 的关键 draw call。',
                createdAt: now,
                resultingWorkstreamIds: [revisionWorkstreamId],
              },
            ],
          })),
          branches: session.branches.map((group, index) => index === 0 ? {
            ...group,
            activeBranchId: branchId,
            branches: [
              ...group.branches.map((branch) => ({ ...branch, status: 'inactive' as const })),
              { id: branchId, parentBranchId: session.activeBranchId, revisionId, status: 'active' as const, workstreamIds: [revisionWorkstreamId] },
            ],
          } : group),
          workstreams: [
            { ...basePlan, planStatus: 'needs_revision' },
            {
              ...basePlan,
              id: revisionWorkstreamId,
              branchId,
              status: 'awaiting_approval',
              density: 'expanded',
              planId: `plan-${revisionId}`,
              planStatus: 'awaiting_approval',
              processEvents: [
                { kind: 'user.revision_requested', id: 'browser-preview-user-revision', workstreamId: revisionWorkstreamId, planId, createdAt: now, prompt: '请缩小计划范围，先验证当前 opened capture 的关键 draw call。' },
                { kind: 'agent.text', id: 'browser-preview-revision-thinking', workstreamId: revisionWorkstreamId, createdAt: now, text: '已根据修改建议创建新的 revision workstream。' },
              ],
              result: basePlan.result ? { ...basePlan.result, id: `${revisionWorkstreamId}-result`, workstreamId: revisionWorkstreamId, status: 'awaiting_approval', title: 'Revised Debugger Plan' } : basePlan.result,
            },
          ],
        };
      }
      case 'failed-tool':
        return {
          ...session,
          workstreams: [{
            ...basePlan,
            status: 'failed',
            processEvents: basePlan.processEvents.map((event) => event.kind === 'tool'
              ? { ...event, status: 'failed' as const, errorSummary: 'RenderDoc inspection command failed in preview data.' }
              : event),
          }],
          progress: session.progress.map((task) => ({ ...task, status: 'blocked' as const, blockerSummary: 'Tool failed' })),
        };
      case 'failed-task':
        return {
          ...session,
          workstreams: [{
            ...basePlan,
            status: 'failed',
            resultKind: 'failure',
            result: { id: 'browser-preview-failure', workstreamId: basePlan.id, kind: 'failure', status: 'failed', title: 'Task Failed', sections: [{ id: 'failure', title: '失败原因', body: '任务失败并以 Failure Result Block 收束。' }], artifactIds: [], createdAt: now },
          }],
          progress: session.progress.map((task) => ({ ...task, status: 'blocked' as const, blockerSummary: 'Task failed' })),
        };
      case 'cancelled-task':
        return {
          ...session,
          latestAcceptedPlanId: planId,
          workstreams: [{
            ...basePlan,
            status: 'cancelled',
            resultKind: 'cancelled',
            result: { id: 'browser-preview-cancelled', workstreamId: basePlan.id, kind: 'cancelled', status: 'cancelled', title: 'Task Cancelled', sections: [{ id: 'cancelled', title: '取消', body: '任务被取消，历史消息和 raw audit ref 保留。' }], artifactIds: [], createdAt: now },
          }],
          progress: session.progress.map((task) => ({ ...task, status: 'cancelled' as const, completedAt: now })),
        };
      case 'sub-agent':
        return {
          ...session,
          workstreams: [{
            ...basePlan,
            processEvents: [
              ...basePlan.processEvents,
              {
                kind: 'subagent',
                id: 'browser-preview-subagent',
                workstreamId: basePlan.id,
                createdAt: now,
                completedAt: now,
                status: 'done',
                label: 'pixel_forensics_agent',
                summary: '检查亮点像素和 render target。',
                resultSummary: '确认需要继续验证 draw call。',
                nestedWorkstream: {
                  id: 'nested-pixel-forensics',
                  title: 'Pixel Forensics Trace',
                  process: [{ kind: 'agent.text', id: 'nested-text', workstreamId: 'nested-pixel-forensics', createdAt: now, text: 'Nested trace 只展示一层。' }],
                },
                rawTraceRef: 'raw-browser-preview-subagent',
              },
            ],
          }],
        };
      case 'long-prompt':
        return {
          ...session,
          userRequests: session.userRequests.map((request) => ({
            ...request,
            revisions: request.revisions.map((revision) => ({
              ...revision,
              prompt: [
                '请完整分析当前打开的 capture，并保持所有历史决策可追溯。',
                '第一步确认 opened capture；第二步建立计划；第三步执行工具；第四步汇总报告。',
                '这个 prompt 故意很长，用于验证 User Prompt Bubble 的换行、折叠、fade 和展开箭头，不应撑爆消息流宽度。',
              ].join('\n\n'),
            })),
          })),
        };
      case 'artifacts-context-accumulation':
        return {
          ...withAcceptedPlan(session, false),
          context: [
            ...session.context,
            { id: 'browser-preview-context-file', sessionId: session.sessionId, workstreamId: basePlan.id, branchId: session.activeBranchId, kind: 'file', label: 'report.md', summary: '正式报告产物文件。', importance: 'important', firstObservedAt: now, lastObservedAt: now },
            { id: 'browser-preview-context-source', sessionId: session.sessionId, workstreamId: basePlan.id, branchId: session.activeBranchId, kind: 'source', label: 'Pipeline State', summary: '被引用的 RenderDoc source context。', importance: 'cited', firstObservedAt: now, lastObservedAt: now },
          ],
        };
      case 'branch-navigator':
        return {
          ...session,
          branches: session.branches.map((group, index) => index === 0 ? {
            ...group,
            branches: [...group.branches, { id: 'branch-preview-alt', parentBranchId: session.activeBranchId, revisionId: 'revision-preview-alt', status: 'inactive' as const, workstreamIds: [] }],
          } : group),
        };
      default:
        return session;
    }
  }

  private promptForWorkstream(session: AgentWorkstreamSession, workstreamId: string) {
    for (const request of session.userRequests) {
      const revision = request.revisions.find((entry) => entry.resultingWorkstreamIds.includes(workstreamId));
      if (!revision) {
        continue;
      }
      const group = session.branches.find((entry) => entry.rootRequestId === request.id);
      return {
        kind: 'user_prompt' as const,
        id: `prompt-${revision.id}`,
        branchId: revision.branchId,
        requestId: request.id,
        revisionId: revision.id,
        prompt: revision.prompt,
        createdAt: revision.createdAt,
        branchIndex: Math.max(group?.branches.findIndex((branch) => branch.id === revision.branchId) ?? 0, 0),
        branchCount: group?.branches.length ?? 1,
        canCopy: true,
        canEdit: true,
      };
    }
    return undefined;
  }

  private createWorkstreamPresentation(session: AgentWorkstreamSession): AgentWorkstreamPresentation {
    const activeWorkstreams = session.workstreams.filter((workstream) => workstream.branchId === session.activeBranchId);
    return {
      sessionId: session.sessionId,
      activeBranchId: session.activeBranchId,
      mode: activeWorkstreams[0]?.type ?? 'ask',
      items: activeWorkstreams.flatMap((workstream) => [{
        kind: 'task_workstream',
        id: workstream.id,
        type: workstream.type,
        status: workstream.status,
        density: workstream.density,
        title: workstream.resultKind === 'plan'
          ? 'Plan Task'
          : workstream.resultKind === 'report'
            ? 'Execution Task'
            : workstream.type === 'ask'
              ? 'Ask Task'
              : 'Agent Task',
        startedAt: workstream.startedAt,
        completedAt: workstream.completedAt,
        prompt: this.promptForWorkstream(session, workstream.id),
        process: {
          collapsed: workstream.status === 'completed',
          items: workstream.processEvents.map((event) => {
            if (event.kind === 'agent.text') {
              return { kind: 'agent_thinking', id: event.id, createdAt: event.createdAt, text: event.text };
            }
            if (event.kind === 'tool') {
              return {
                kind: 'tool_row',
                id: event.id,
                createdAt: event.createdAt,
                completedAt: event.completedAt,
                status: event.status,
                title: event.title,
                summary: event.summary,
                target: event.target,
                durationMs: event.durationMs,
                taskId: event.taskId,
                artifactIds: event.artifactIds ?? [],
                rawTraceRef: event.rawTraceRef,
                inputRef: event.inputRef,
                outputRef: event.outputRef,
                errorSummary: event.errorSummary,
              };
            }
            if (event.kind === 'subagent') {
              return {
                kind: 'subagent_row',
                id: event.id,
                createdAt: event.createdAt,
                completedAt: event.completedAt,
                status: event.status,
                label: event.label,
                summary: event.summary,
              };
            }
            return {
              kind: 'subagent_row',
              id: event.id,
              createdAt: event.createdAt,
              status: 'done',
              label: 'User',
              summary: event.kind === 'user.confirmed' ? event.label : event.prompt,
            };
          }),
        },
        result: workstream.result ? {
          ...workstream.result,
          artifacts: session.artifacts.filter((artifact) => workstream.result?.artifactIds.includes(artifact.id)),
        } : undefined,
        planId: workstream.planId,
        planStatus: workstream.planStatus,
      }, ...workstream.processEvents.flatMap((event): AgentWorkstreamPresentation['items'] => {
        if (event.kind === 'user.confirmed') {
          return [{
            kind: 'user_confirmation',
            id: event.id,
            workstreamId: event.workstreamId,
            planId: event.planId,
            label: event.label,
            createdAt: event.createdAt,
          }];
        }
        if (event.kind === 'user.revision_requested') {
          return [{
            kind: 'user_revision',
            id: event.id,
            workstreamId: event.workstreamId,
            planId: event.planId,
            prompt: event.prompt,
            createdAt: event.createdAt,
          }];
        }
        return [];
      })]),
      rightPanel: {
        progress: {
          current: session.progress.filter((task) => task.status !== 'completed'),
          history: session.progress.filter((task) => task.status === 'completed'),
        },
        artifacts: {
          current: session.artifacts,
          previous: [],
        },
        context: {
          groups: (['capture', 'file', 'source', 'capability'] as const).map((kind) => {
            const all = session.context.filter((record) => record.kind === kind);
            return { kind, important: all.filter((record) => record.importance !== 'normal'), all };
          }),
        },
      },
      approval: activeWorkstreams.find((workstream) => workstream.planStatus === 'awaiting_approval') ? {
        planId: activeWorkstreams.find((workstream) => workstream.planStatus === 'awaiting_approval')?.planId ?? session.latestDisplayedPlanId ?? 'browser-preview-plan',
        runId: this.workflowState.runId,
        workstreamId: activeWorkstreams.find((workstream) => workstream.planStatus === 'awaiting_approval')?.id ?? `ws-${this.workflowState.runId}-plan`,
        status: 'awaiting_approval',
        title: activeWorkstreams.find((workstream) => workstream.planStatus === 'awaiting_approval')?.result?.title ?? 'Browser Preview Debug Plan',
        summary: activeWorkstreams.find((workstream) => workstream.planStatus === 'awaiting_approval')?.result?.sections.map((section) => `${section.title}: ${section.body}`).join('\n') ?? '',
        canApprove: true,
        canRequestRevision: true,
      } : null,
      branchNavigator: session.branches[0] ? {
        activeBranchId: session.activeBranchId,
        branchIndex: Math.max(session.branches[0].branches.findIndex((branch) => branch.id === session.activeBranchId), 0),
        branchCount: session.branches[0].branches.length,
        branches: session.branches[0].branches,
      } : null,
      rawAuditRefs: session.rawAuditRefs,
      updatedAt: session.updatedAt,
    };
  }

  private async requestPlanRevision(runId: string, revisionText: string): Promise<WorkstreamRevisionResult> {
    const session = this.workstreamSession ?? this.createWorkstreamSession();
    const branchId = createId('branch');
    const revisionId = createId('revision');
    const workstreamId = `ws-${runId}-revision-${Date.now()}`;
    const now = new Date().toISOString();
    const request = session.userRequests[0];
    const nextRevision = {
      id: revisionId,
      requestId: request.id,
      branchId,
      parentRevisionId: request.activeRevisionId,
      prompt: revisionText,
      createdAt: now,
      resultingWorkstreamIds: [workstreamId],
    };
    this.workstreamSession = {
      ...session,
      activeBranchId: branchId,
      latestDisplayedPlanId: `plan-${revisionId}`,
      latestAcceptedPlanId: undefined,
      userRequests: [{
        ...request,
        activeRevisionId: revisionId,
        revisions: [...request.revisions, nextRevision],
      }],
      branches: session.branches.map((group, index) => index === 0 ? {
        ...group,
        activeBranchId: branchId,
        branches: [
          ...group.branches.map((branch) => branch.id === session.activeBranchId ? { ...branch, status: 'inactive' as const } : branch),
          { id: branchId, parentBranchId: session.activeBranchId, revisionId, status: 'active' as const, workstreamIds: [workstreamId] },
        ],
      } : group),
      workstreams: [
        ...session.workstreams.map((workstream) => workstream.planId === session.latestDisplayedPlanId
          ? { ...workstream, planStatus: 'needs_revision' as const }
          : workstream),
        {
          id: workstreamId,
          sessionId: session.sessionId,
          branchId,
          type: 'debugger',
          status: 'awaiting_approval',
          density: 'expanded',
          resultKind: 'plan',
          startedAt: now,
          processEvents: [{ kind: 'agent.text', id: `agent-text-${revisionId}`, workstreamId, createdAt: now, text: '已根据修改建议创建新的计划分支。' }],
          result: {
            id: `${workstreamId}-result`,
            workstreamId,
            kind: 'plan',
            status: 'awaiting_approval',
            title: 'Revised Browser Preview Plan',
            sections: [{ id: 'revision', title: '修改建议', body: revisionText }],
            artifactIds: [],
            createdAt: now,
          },
          planId: `plan-${revisionId}`,
          planStatus: 'awaiting_approval',
        },
      ],
      updatedAt: now,
    };
    this.workstreamPresentation = this.createWorkstreamPresentation(this.workstreamSession);
    this.emit('workflow:workstreamChanged', { sessionId: session.sessionId, presentation: this.workstreamPresentation });
    return {
      success: true,
      runId,
      planId: `plan-${revisionId}`,
      branchId,
      session: this.workstreamSession,
      presentation: this.workstreamPresentation,
    };
  }

  private createUsage(runId: string): RunContextUsageSummary {
    if (this.usage && this.usage.runId === runId) {
      return this.usage;
    }

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
        toolsRoot: previewPath('resources', 'tools'),
        version: 'browser-preview',
        catalog: {
          path: previewPath('resources', 'tools', 'catalog.json'),
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
    if (this.actionEvents.length > 0) {
      return this.actionEvents;
    }

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
        refs: this.openedCapture?.filePath ? [this.openedCapture.filePath] : [],
        payload: {
          mode: 'browser-preview',
          scenarioId: this.scenarioId,
        },
      },
    ];
  }

  private createContextSnapshotFallback(): ContextSnapshot {
    const openedCapture = this.openedCapture;
    const device = this.devices[0];
    const sessionId = openedCapture?.sessionId ?? this.currentSessionId ?? this.sessions[0]?.sessionId ?? 'browser-preview-session';
    const contextId = openedCapture?.contextId ?? 'browser-preview-context';
    const captureId = openedCapture?.captureId ?? 'browser-preview-capture';
    const captureDescriptor: CaptureDescriptor = {
      id: captureId,
      filePath: openedCapture?.filePath ?? previewPath('captures', `${captureId}.rdc`),
      captureFileId: openedCapture?.captureFileId ?? captureId,
      role: 'primary',
      backendHint: openedCapture?.backend ?? 'local',
      status: openedCapture?.status ?? 'open',
      sessionId,
      replaySessionId: openedCapture?.replaySessionId ?? 'browser-preview-replay',
      contextId,
    };

    return {
      contextId,
      sessionId,
      backend: openedCapture?.backend ?? 'local',
      runtimeOwner: 'browser-preview',
      ownerLeaseId: 'browser-preview-lease',
      captureDescriptors: [captureDescriptor],
      activeCapture: captureId,
      deviceLabel: openedCapture?.deviceLabel ?? device?.label ?? 'Local Browser Preview',
      humanPreview: {
        status: 'closed',
        updatedAt: Date.now(),
      },
    };
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
      ...(this.contextSnapshot ?? this.createContextSnapshotFallback()),
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
      ...(this.contextSnapshot ?? this.createContextSnapshotFallback()),
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

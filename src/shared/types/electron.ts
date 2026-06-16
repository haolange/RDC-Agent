import type {
  WorkflowStage,
  WorkflowState,
} from './workflow';
import type { AgentConfig, AgentRole, AgentState } from './agent';
import type { ActionEvent, EventType } from './evidence';
import type {
  ConversationCancelActiveTurnRequest,
  ConversationCancelActiveTurnResult,
  ConversationAnswerUserInputRequest,
  ConversationAnswerUserInputResult,
  ConversationAnswerToolApprovalRequest,
  ConversationAnswerToolApprovalResult,
  ConversationMessage,
  ConversationSendRequest,
  ConversationStreamEvent,
  ConversationTurnResult,
} from './conversation';
import type { ReplayDeviceEntry, ReplayDeviceStatusChangedPayload } from './device';
import type { LLMConfig } from './llm';
import type { RuntimeLogEntry, RuntimeLogScope } from './runtimeLog';
import type {
  AppSettings,
  AppSettingsPatch,
  LlmProviderAccountStatus,
  LlmProviderAccountLoginFinishRequest,
  LlmProviderConnectionResult,
  LlmProviderDraftRequest,
  LlmProviderId,
  ResolvedTheme,
} from './settings';
import type {
  CaptureDescriptor,
  ContextSnapshot,
  OpenProjectInputRequest,
  OpenedCaptureState,
  ProjectInputRecord,
  ProjectRecord,
  RunContextUsageSummary,
  RunSummary,
  SessionAttachmentRecord,
  SessionOutputRecord,
  SessionRecord,
} from './session';
import type { TerminalCreateTabRequest, TerminalDataEvent, TerminalExitEvent, TerminalTabRecord } from './terminal';
import type { ToolCatalog, ToolRuntimeSummary } from './tool';
import type { CommandExecuteRequest, CommandListResult } from './command';
import type { AgentRun, AgentRunPresentation, TraceEvent } from './agenticTrace';
import type {
  TraceBranchSwitchResult,
  TraceExportOptions,
  TraceExportResult,
  TraceSessionResult,
} from './trace';

export interface ElectronAPI {
  platform: NodeJS.Platform;
  isMac: boolean;
  isWindows: boolean;
  isLinux: boolean;

  appMeta: {
    get: () => Promise<{
      version: string;
      productName: string;
      systemTheme: ResolvedTheme;
      testMode: boolean;
    }>;
  };

  appShell: {
    selectAvatar: () => Promise<string | null>;
    getAvatarDataUrl: (avatarPath: string) => Promise<string | null>;
    openPath: (targetPath: string) => Promise<{
      success: boolean;
      error?: string;
    }>;
    copyText: (text: string) => Promise<{
      success: boolean;
    }>;
  };

  conversation: {
    sendMessage: (request: ConversationSendRequest) => Promise<ConversationTurnResult>;
    cancelActiveTurn: (request?: ConversationCancelActiveTurnRequest) => Promise<ConversationCancelActiveTurnResult>;
    answerUserInput: (request: ConversationAnswerUserInputRequest) => Promise<ConversationAnswerUserInputResult>;
    answerToolApproval: (request: ConversationAnswerToolApprovalRequest) => Promise<ConversationAnswerToolApprovalResult>;
    getHistory: (sessionId: string) => Promise<{
      messages: ConversationMessage[];
    }>;
    onEvent: (callback: (event: ConversationStreamEvent) => void) => void;
    offEvent: (callback: (event: ConversationStreamEvent) => void) => void;
  };

  selectFiles: () => Promise<string[] | null>;
  selectRdcFiles: () => Promise<string[] | null>;
  selectDirectory: () => Promise<string | null>;

  workflow: {
    getState: () => Promise<WorkflowState>;
    resume: (sessionId?: string) => Promise<{
      success: boolean;
      error?: string;
    }>;
    stop: (runId?: string) => Promise<{
      success: boolean;
      error?: string;
    }>;
    getRunUsage: (runId?: string) => Promise<{
      usage: RunContextUsageSummary | null;
    }>;
    listRuns: () => Promise<{ runs: RunSummary[] }>;
    listActiveRuns: () => Promise<{ runs: Array<{ runId: string; sessionId: string; projectId: string; startedAt: number; stage?: string }> }>;
  };

  agent: {
    sendMessage: (agentId: AgentRole, content: string) => Promise<{
      response?: string;
      error?: string;
    }>;
    getState: (agentId: AgentRole) => Promise<AgentState>;
    getAllStates: () => Promise<AgentState[]>;
    configure: (agentId: AgentRole, config: Partial<AgentConfig>) => Promise<{
      success: boolean;
      error?: string;
    }>;
  };

  command: {
    list: (category?: string) => Promise<CommandListResult>;
    execute: (request: CommandExecuteRequest) => Promise<{
      result: {
        success: boolean;
        message: string;
        data?: unknown;
        sideEffect?: string;
        systemMessage?: string;
        uiAction?: { type: string; payload?: unknown };
        invalidateStores?: Array<string>;
      };
      systemMessage?: import('./conversation').ConversationMessage;
    }>;
  };

  tool: {
    getCatalog: () => Promise<ToolCatalog>;
    getRuntimeSummary: () => Promise<ToolRuntimeSummary>;
  };

  evidence: {
    getChain: () => Promise<{
      sessionId: string;
      runId: string;
      events: ActionEvent[];
      isValid: boolean;
    }>;
    getEvents: (eventType?: EventType) => Promise<ActionEvent[]>;
  };

  llm: {
    configure: (config: LLMConfig) => Promise<void>;
    testConnection: (provider: string) => Promise<{
      success: boolean;
      error?: string;
    }>;
    getAvailableModels: (provider: string) => Promise<string[]>;
    testProviderDraft: (request: LlmProviderDraftRequest) => Promise<LlmProviderConnectionResult>;
    connectProvider: (request: LlmProviderDraftRequest) => Promise<LlmProviderConnectionResult>;
    refreshProviderModels: (providerId: LlmProviderId) => Promise<LlmProviderConnectionResult>;
    disconnectProvider: (providerId: LlmProviderId) => Promise<LlmProviderConnectionResult>;
    startProviderAccountLogin: (providerId: LlmProviderId) => Promise<LlmProviderAccountStatus>;
    getProviderAccountStatus: (providerId: LlmProviderId) => Promise<LlmProviderAccountStatus>;
    finishProviderAccountLogin: (request: LlmProviderAccountLoginFinishRequest) => Promise<LlmProviderAccountStatus>;
    logoutProviderAccount: (providerId: LlmProviderId) => Promise<LlmProviderAccountStatus>;
  };

  settings: {
    get: () => Promise<AppSettings>;
    getProviderSecret: (providerId: string) => Promise<string>;
    importAgentManifest: (filePath: string) => Promise<AppSettings>;
    set: (settings: AppSettingsPatch) => Promise<AppSettings>;
  };

  project: {
    list: () => Promise<{ projects: ProjectRecord[] }>;
    add: (rootPath: string) => Promise<{
      success: boolean;
      project?: ProjectRecord;
      error?: string;
    }>;
    select: (projectId: string) => Promise<{
      success: boolean;
      project?: ProjectRecord;
      currentSession?: SessionRecord | null;
      currentRun?: RunSummary | null;
      error?: string;
    }>;
    rename: (projectId: string, newName: string) => Promise<{
      success: boolean;
      project?: ProjectRecord;
      error?: string;
    }>;
    remove: (projectId: string) => Promise<{
      success: boolean;
      error?: string;
    }>;
    inputs: {
      list: (projectId: string) => Promise<{ inputs: ProjectInputRecord[] }>;
      refresh: (projectId: string) => Promise<{ inputs: ProjectInputRecord[] }>;
      import: (projectId: string) => Promise<{
        success: boolean;
        inputs: ProjectInputRecord[];
        error?: string;
      }>;
      importPaths: (projectId: string, filePaths: string[]) => Promise<{
        success: boolean;
        inputs: ProjectInputRecord[];
        error?: string;
      }>;
    };
  };

  device: {
    list: () => Promise<ReplayDeviceEntry[]>;
    refresh: () => Promise<ReplayDeviceEntry[]>;
    activate: (deviceId: string) => Promise<ReplayDeviceEntry>;
  };

  session: {
    list: (projectId?: string) => Promise<{ sessions: SessionRecord[] }>;
    create: (projectId: string, title?: string) => Promise<{
      success: boolean;
      session?: SessionRecord;
      error?: string;
    }>;
    rename: (id: string, title: string) => Promise<{
      success: boolean;
      session?: SessionRecord;
      error?: string;
    }>;
    remove: (id: string) => Promise<{
      success: boolean;
      nextSession?: SessionRecord | null;
      nextRun?: RunSummary | null;
      error?: string;
    }>;
    select: (id: string) => Promise<{
      success: boolean;
      session?: SessionRecord;
      currentRun?: RunSummary | null;
      error?: string;
    }>;
    attachments: {
      list: (sessionId: string) => Promise<{
        attachments: SessionAttachmentRecord[];
      }>;
      import: (sessionId: string, filePaths: string[]) => Promise<{
        success: boolean;
        attachments: SessionAttachmentRecord[];
        error?: string;
      }>;
    };
    outputs: {
      list: (sessionId: string, runId?: string) => Promise<{
        outputs: SessionOutputRecord[];
      }>;
    };
  };

  run: {
    list: (sessionId: string) => Promise<{ runs: RunSummary[] }>;
  };

  runtimeLog: {
    list: (request: { scope: RuntimeLogScope; sessionId?: string | null }) => Promise<{
      entries: RuntimeLogEntry[];
    }>;
  };

  terminal: {
    listTabs: () => Promise<{ tabs: TerminalTabRecord[] }>;
    createTab: (request?: TerminalCreateTabRequest) => Promise<{ success: boolean; tab?: TerminalTabRecord; tabs: TerminalTabRecord[]; error?: string }>;
    closeTab: (tabId: string) => Promise<{ success: boolean; tabs: TerminalTabRecord[]; error?: string }>;
    activateTab: (tabId: string) => Promise<{ success: boolean; tabs: TerminalTabRecord[]; error?: string }>;
    write: (tabId: string, data: string) => Promise<{ success: boolean; error?: string }>;
    resize: (tabId: string, cols: number, rows: number) => Promise<{ success: boolean; error?: string }>;
  };

  capture: {
    list: () => Promise<{ captures: CaptureDescriptor[] }>;
    select: (captureId: string) => Promise<{
      success: boolean;
      error?: string;
    }>;
    openProjectInput: (
      request: Omit<OpenProjectInputRequest, 'replayDevice'> & { replayDeviceId: string }
    ) => Promise<{
      success: boolean;
      openedCapture?: OpenedCaptureState;
      contextSnapshot?: ContextSnapshot;
      error?: string;
    }>;
    getOpenedState: () => Promise<OpenedCaptureState | null>;
    clearOpenedState: () => Promise<{
      success: boolean;
    }>;
  };

  context: {
    get: () => Promise<ContextSnapshot>;
    openHumanPreview: (request?: { sessionId?: string }) => Promise<{
      success: boolean;
      contextSnapshot?: ContextSnapshot;
      error?: string;
    }>;
    closeHumanPreview: () => Promise<{
      success: boolean;
      contextSnapshot?: ContextSnapshot;
      error?: string;
    }>;
  };

  trace: {
    getRun: (runId: string) => Promise<{ run: AgentRun | null }>;
    getEvents: (runId: string, afterSeq?: number) => Promise<{ events: TraceEvent[] }>;
    getProjection: (sessionId?: string) => Promise<TraceSessionResult>;
    exportRun: (runId: string) => Promise<{ run: AgentRun | null; events: TraceEvent[] }>;
    switchBranch: (sessionId: string, branchId: string) => Promise<TraceBranchSwitchResult>;
    exportSession: (sessionId: string, options?: TraceExportOptions) => Promise<TraceExportResult>;
  };

  events: {
    onWorkflowStateChanged: (callback: (state: WorkflowState) => void) => () => void;
    onWorkflowStageChanged: (callback: (data: { stage: WorkflowStage; blockers: unknown[] }) => void) => () => void;
    onRunStatusChanged: (callback: (data: { runId: string; sessionId: string; status: RunSummary['status']; lastStage?: string; stopReason?: string }) => void) => () => void;
    onRunUsageChanged: (callback: (summary: RunContextUsageSummary) => void) => () => void;
    onTraceProjectionChanged: (callback: (payload: { sessionId: string; presentation: AgentRunPresentation }) => void) => () => void;
    onAgentMessage: (callback: (msg: unknown) => void) => () => void;
    onAgentStatusChanged: (callback: (state: AgentState) => void) => () => void;
    onToolExecutionComplete: (callback: (trace: unknown) => void) => () => void;
    onEvidenceEventAdded: (callback: (event: ActionEvent) => void) => () => void;
    onDeviceStatusChanged: (callback: (status: ReplayDeviceStatusChangedPayload) => void) => () => void;
    onCaptureStatusChanged: (callback: (status: unknown) => void) => () => void;
    onContextChanged: (callback: (snapshot: ContextSnapshot) => void) => () => void;
    onProjectInputsChanged: (callback: (payload: { projectId: string; inputs: ProjectInputRecord[] }) => void) => () => void;
    onOpenedCaptureStateChanged: (callback: (state: OpenedCaptureState | null) => void) => () => void;
    onRuntimeLogAppended: (callback: (entry: RuntimeLogEntry) => void) => () => void;
    onTerminalData: (callback: (event: TerminalDataEvent) => void) => () => void;
    onTerminalExit: (callback: (event: TerminalExitEvent) => void) => () => void;
    onTerminalTabsChanged: (callback: (payload: { tabs: TerminalTabRecord[] }) => void) => () => void;
    onAppThemeChanged: (callback: (theme: ResolvedTheme) => void) => () => void;
    removeAllListeners: (channel: string) => void;
  };

  windowControls: {
    minimize: () => Promise<void>;
    toggleMaximize: () => Promise<boolean>;
    close: () => Promise<void>;
    isMaximized: () => Promise<boolean>;
  };

  on: (channel: string, callback: (...args: unknown[]) => void) => void;
  off: (channel: string, callback: (...args: unknown[]) => void) => void;
}

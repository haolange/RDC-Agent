import type {
  AskUserAnswer,
  AskUserPrompt,
  BacktrackTrigger,
  DebugPlan,
  WorkflowStage,
  WorkflowState,
} from './workflow';
import type { AgentConfig, AgentRole, AgentState } from './agent';
import type { ActionEvent, EventType } from './evidence';
import type { ConversationMessage, ConversationSendRequest, ConversationTurnResult } from './conversation';
import type { ReplayDeviceEntry, ReplayDeviceStatusChangedPayload } from './device';
import type { LLMConfig } from './llm';
import type { RuntimeLogEntry, RuntimeLogScope } from './runtimeLog';
import type {
  AppSettings,
  AppSettingsPatch,
  ResolvedTheme,
} from './settings';
import type {
  CaptureDescriptor,
  ContextSnapshot,
  DebugSessionStartRequest,
  OpenProjectInputRequest,
  OpenedCaptureState,
  ProjectInputRecord,
  ProjectRecord,
  RunSummary,
  SessionAttachmentRecord,
  SessionRecord,
} from './session';
import type { TerminalDataEvent, TerminalExitEvent, TerminalTabRecord } from './terminal';
import type { ToolCallResult, ToolCatalog } from './tool';

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
    }>;
  };

  appShell: {
    selectAvatar: () => Promise<string | null>;
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
    getHistory: (sessionId: string) => Promise<{
      messages: ConversationMessage[];
    }>;
  };

  selectFiles: () => Promise<string[] | null>;
  selectRdcFiles: () => Promise<string[] | null>;
  selectDirectory: () => Promise<string | null>;

  workflow: {
    getState: () => Promise<WorkflowState>;
    start: (request: DebugSessionStartRequest) => Promise<{
      success: boolean;
      caseId?: string;
      runId?: string;
      sessionId?: string;
      currentStage?: WorkflowStage;
      status?: RunSummary['status'];
      planStatus?: string;
      pendingQuestions?: AskUserPrompt | null;
      debugPlanSummary?: DebugPlan | null;
      error?: string;
    }>;
    getPlan: (runId: string) => Promise<{
      success: boolean;
      runId?: string;
      sessionId?: string;
      debugPlan?: DebugPlan | null;
      pendingQuestions?: AskUserPrompt | null;
      approvalState?: string;
      error?: string;
    }>;
    submitQuestions: (runId: string, answers: AskUserAnswer[]) => Promise<{
      success: boolean;
      runId?: string;
      sessionId?: string;
      debugPlan?: DebugPlan | null;
      pendingQuestions?: AskUserPrompt | null;
      approvalState?: string;
      error?: string;
    }>;
    approvePlan: (runId: string) => Promise<{
      success: boolean;
      runId?: string;
      sessionId?: string;
      debugPlan?: DebugPlan | null;
      pendingQuestions?: AskUserPrompt | null;
      approvalState?: string;
      error?: string;
    }>;
    restartRun: (runId: string) => Promise<{
      success: boolean;
      runId?: string;
      sessionId?: string;
      debugPlan?: DebugPlan | null;
      pendingQuestions?: AskUserPrompt | null;
      approvalState?: string;
      error?: string;
    }>;
    resume: (sessionId?: string) => Promise<{
      success: boolean;
      error?: string;
    }>;
    stop: (runId?: string) => Promise<{
      success: boolean;
      error?: string;
    }>;
    listRuns: () => Promise<{ runs: RunSummary[] }>;
    listActiveRuns: () => Promise<{ runs: Array<{ runId: string; sessionId: string; projectId: string; startedAt: number; stage?: string }> }>;
    advanceStage: () => Promise<{
      success: boolean;
      currentStage?: WorkflowStage;
      error?: string;
    }>;
    backtrack: (reason: string, trigger: BacktrackTrigger) => Promise<{
      success: boolean;
      error?: string;
    }>;
    dispatchSpecialist: (agentId: AgentRole, objective: string) => Promise<{
      success: boolean;
      tokenId?: string;
      error?: string;
    }>;
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

  tool: {
    getCatalog: () => Promise<ToolCatalog>;
    execute: (toolName: string, args: Record<string, unknown>) => Promise<ToolCallResult>;
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
  };

  settings: {
    get: () => Promise<AppSettings>;
    getProviderSecret: (providerId: string) => Promise<string>;
    set: (settings: AppSettingsPatch) => Promise<AppSettings>;
  };

  project: {
    list: () => Promise<{ projects: ProjectRecord[] }>;
    add: (rootPath: string) => Promise<{
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
    createTab: (request?: { cwd?: string | null }) => Promise<{ success: boolean; tab?: TerminalTabRecord; tabs: TerminalTabRecord[]; error?: string }>;
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
  };

  events: {
    onWorkflowStateChanged: (callback: (state: WorkflowState) => void) => void;
    onWorkflowStageChanged: (callback: (data: { stage: WorkflowStage; blockers: unknown[] }) => void) => void;
    onRunStatusChanged: (callback: (data: { runId: string; sessionId: string; status: RunSummary['status']; lastStage?: string; stopReason?: string }) => void) => void;
    onAgentMessage: (callback: (msg: unknown) => void) => void;
    onAgentStatusChanged: (callback: (state: AgentState) => void) => void;
    onToolExecutionComplete: (callback: (trace: unknown) => void) => void;
    onEvidenceEventAdded: (callback: (event: ActionEvent) => void) => void;
    onDeviceStatusChanged: (callback: (status: ReplayDeviceStatusChangedPayload) => void) => void;
    onCaptureStatusChanged: (callback: (status: unknown) => void) => void;
    onContextChanged: (callback: (snapshot: ContextSnapshot) => void) => void;
    onProjectInputsChanged: (callback: (payload: { projectId: string; inputs: ProjectInputRecord[] }) => void) => void;
    onOpenedCaptureStateChanged: (callback: (state: OpenedCaptureState | null) => void) => void;
    onRuntimeLogAppended: (callback: (entry: RuntimeLogEntry) => void) => void;
    onTerminalData: (callback: (event: TerminalDataEvent) => void) => void;
    onTerminalExit: (callback: (event: TerminalExitEvent) => void) => void;
    onTerminalTabsChanged: (callback: (payload: { tabs: TerminalTabRecord[] }) => void) => void;
    onAppThemeChanged: (callback: (theme: ResolvedTheme) => void) => void;
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

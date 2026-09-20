import type { CaptureReplayState, CaptureReplayApplyRequest } from './captureReplay';
import type {
  WorkflowState,
} from './workflow';
import type { AgentConfig, AgentRole, AgentState } from './agent';
import type {
  AgentDefinitionCommitSnapshot,
  AgentDefinitionSaveRequest,
  AgentDefinitionSaveResult,
} from './agentManifest';
import type { ActionEvent, EventType } from './evidence';
import type {
  ConversationCancelActiveTurnRequest,
  ConversationCancelActiveTurnResult,
  ConversationAnswerUserInputRequest,
  ConversationAnswerUserInputResult,
  ConversationAnswerToolApprovalRequest,
  ConversationAnswerToolApprovalResult,
  ConversationAnswerPlanReviewRequest,
  ConversationAnswerPlanReviewResult,
  ConversationGetAttachmentPreviewRequest,
  ConversationGetAttachmentPreviewResult,
  ConversationMessage,
  ConversationReleaseAttachmentsRequest,
  ConversationReleaseAttachmentsResult,
  ConversationRewriteFromMessageRequest,
  ConversationSendRequest,
  ConversationSendResult,
  ConversationStageAttachmentsRequest,
  ConversationStageAttachmentsResult,
  ConversationStreamEvent,
  ConversationTurnResult,
} from './conversation';
import type { ReplayDeviceEntry, ReplayDeviceStatusChangedPayload } from './device';
import type {
  PlanApprovalTokenRequest,
  PlanExportRequest,
  PlanExportResult,
  PlanReadRequest,
  PlanReadResult,
  PlanReviewHandoffSuggestion,
  PlanSaveToProjectRequest,
  PlanSaveToProjectResult,
} from './planReview';
import type { EffectiveCatalogSnapshot, EffectiveModel } from './providerCapability';
import type { ModelsOverride } from '../provider-catalog/modelsOverrideSchema';
import type { RuntimeLogEntry, RuntimeLogScope } from './runtimeLog';
import type {
  AgentPermissionMode,
  AppSettings,
  AppSettingsPatch,
  ResolvedShellSnapshot,
  LlmProviderAccountStatus,
  LlmProviderAccountLoginStartRequest,
  LlmProviderAccountLoginFinishRequest,
  LlmProviderCatalogResponse,
  LlmProviderConnectionResult,
  LlmProviderDraftRequest,
  LlmProviderId,
  LlmModelCapabilityProbeRequest,
  LlmModelCapabilityProbeResult,
  ProviderDefinitionCommitSnapshot,
  ProviderDefinitionSaveRequest,
  ProviderDefinitionSaveResult,
  ResolvedTheme,
} from './settings';
import type {
  CaptureDescriptor,
  ContextSnapshot,
  OpenProjectInputRequest,
  OpenedCaptureState,
  ProjectInputRecord,
  ProjectRecord,
  RunContextUsageReadResult,
  RunContextUsageRequest,
  RunContextUsageSummary,
  RunSummary,
  SessionRecord,
  SessionScope,
  SessionScopedPayload,
} from './session';
import type { ToolCatalog, ToolRuntimeSummary } from './tool';
import type { MCPServerStatusSummary } from './mcp';
import type { CommandExecuteRequest, CommandListResult, CommandResult } from './command';
import type { AgentRun, TraceEvent, TraceProjectionChangedPayload } from './agenticTrace';
import type {
  TraceBranchSwitchResult,
  TraceSessionResult,
} from './trace';
import type { HookEvent, RdcRuntimeOverview, RequestEnvelopeSnapshot, ScopedResourceImportRequest, ScopedResourceKind, ScopedResourceWriteRequest } from './rdcRuntime';
import type {
  KnowledgeImportResult,
  KnowledgeCandidatesResult,
  KnowledgeCardDetail,
  KnowledgeCardRecord,
  KnowledgeHumanConfirmation,
  KnowledgeIndexOverview,
  KnowledgeLifecycle,
  KnowledgeOverviewResult,
  KnowledgePack,
  KnowledgeQueryRequest,
  KnowledgeQueryResult,
  SessionKnowledgeCandidate,
} from './knowledge';
import type { KnowledgeExportRequest, KnowledgeExportResult } from './knowledgeExport';
import type {
  InvestigationReadIpcResult,
  InvestigationReadRequest,
} from './renderdocInvestigation';

/** Memory 面板列表项摘要（对应 MemoryRecord 的精简视图）。 */
export interface MemorySummary {
  scope: 'user' | 'project';
  /** Canonical storage key; use displayName for user-facing text. */
  name: string;
  displayName: string;
  description: string;
  type: 'user' | 'feedback' | 'project' | 'reference';
  updatedAt: number;
}

/** Memory 面板详情（含完整正文）。 */
export interface MemoryDetail extends MemorySummary {
  content: string;
  tags?: string[];
  createdAt: number;
}

/** Memory 写入请求（对应 MemoryStore.writeMemory 入参）。审批必须用 Main 发放的 approvalToken。 */
export interface MemoryWriteRequest {
  scope: 'user' | 'project';
  projectRoot?: string;
  approvalToken: string;
  name: string;
  description: string;
  type: 'user' | 'feedback' | 'project' | 'reference';
  content: string;
  tags?: string[];
}

/** Main 发放的敏感操作 approvalToken 请求。 */
export interface MemoryApprovalTokenRequest {
  action: 'memory.write' | 'memory.delete';
  scope: 'user' | 'project';
  name?: string;
  projectRoot?: string;
}

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
    hasSeenGettingStarted: () => Promise<boolean>;
    acknowledgeGettingStarted: () => Promise<void>;
    selectAvatar: () => Promise<string | null>;
    getAvatarDataUrl: (avatarPath: string) => Promise<string | null>;
    openPath: (targetPath: string) => Promise<{
      success: boolean;
      error?: string;
    }>;
    copyText: (text: string) => Promise<{
      success: boolean;
    }>;
    readClipboardText: () => Promise<{
      success: boolean;
      text: string;
    }>;
  };

  web: {
    resolveFavicon: (domain: string) => Promise<{
      dataUrl: string | null;
    }>;
  };

  conversation: {
    sendMessage: (request: ConversationSendRequest) => Promise<ConversationSendResult>;
    rewriteFromMessage: (request: ConversationRewriteFromMessageRequest) => Promise<ConversationTurnResult>;
    cancelActiveTurn: (request?: ConversationCancelActiveTurnRequest) => Promise<ConversationCancelActiveTurnResult>;
    answerUserInput: (request: ConversationAnswerUserInputRequest) => Promise<ConversationAnswerUserInputResult>;
    answerToolApproval: (request: ConversationAnswerToolApprovalRequest) => Promise<ConversationAnswerToolApprovalResult>;
    answerPlanReview: (request: ConversationAnswerPlanReviewRequest) => Promise<ConversationAnswerPlanReviewResult>;
    getHistory: (sessionId: string) => Promise<{
      messages: ConversationMessage[];
      branchState?: import('./conversationBranch').ConversationBranchState | null;
    }>;
    switchBranch: (request: import('./conversationBranch').ConversationSwitchBranchRequest) => Promise<import('./conversationBranch').ConversationSwitchBranchResult>;
    clearHistory: (sessionId: string) => Promise<{
      success: boolean;
      messages: ConversationMessage[];
      error?: string;
    }>;
    undoLastTurn: (sessionId: string) => Promise<{
      success: boolean;
      messages: ConversationMessage[];
      error?: string;
    }>;
    getToolImagePreview: (request: { sessionId: string; previewId: string }) => Promise<{
      dataUrl: string | null;
      error?: string;
    }>;
    stageAttachments: (
      request: ConversationStageAttachmentsRequest,
    ) => Promise<ConversationStageAttachmentsResult>;
    releaseAttachments: (
      request: ConversationReleaseAttachmentsRequest,
    ) => Promise<ConversationReleaseAttachmentsResult>;
    getAttachmentPreview: (
      request: ConversationGetAttachmentPreviewRequest,
    ) => Promise<ConversationGetAttachmentPreviewResult>;
    onEvent: (callback: (event: ConversationStreamEvent) => void) => void;
    offEvent: (callback: (event: ConversationStreamEvent) => void) => void;
  };

  selectFiles: () => Promise<string[] | null>;
  selectRdcFiles: () => Promise<string[] | null>;
  selectKnowledgeImport: () => Promise<string | null>;
  selectDirectory: () => Promise<string | null>;
  saveFile: (request: { defaultFileName: string; extension: string }) => Promise<string | null>;

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
    /**
     * 读取上下文用量快照。key 优先级：runId > sessionId > handler 内部 currentRunId。
     * sessionId 用于 Ask 模式（无 debug run，用量以 sessionId 为 store key）。
     */
    getRunUsage: (request: RunContextUsageRequest) => Promise<RunContextUsageReadResult>;
    listRuns: () => Promise<{ runs: RunSummary[] }>;
    listActiveRuns: () => Promise<{ runs: Array<{ runId: string; sessionId: string; projectId: string; startedAt: number }> }>;
  };

  agent: {
    sendMessage: (agentId: AgentRole, content: string) => Promise<{
      response?: string;
      error?: string;
    }>;
    getState: (agentId: AgentRole, sessionId?: string) => Promise<AgentState | null>;
    getAllStates: () => Promise<AgentState[]>;
    configure: (agentId: AgentRole, config: Partial<AgentConfig>) => Promise<{
      success: boolean;
      error?: string;
    }>;
  };

  memory: {
    issueApprovalToken: (request: MemoryApprovalTokenRequest) => Promise<{ token?: string; error?: string }>;
    list: (scope: 'user' | 'project', projectRoot?: string) => Promise<{ memories: MemorySummary[] }>;
    get: (scope: 'user' | 'project', name: string, projectRoot?: string) => Promise<{ memory: MemoryDetail | null }>;
    write: (request: MemoryWriteRequest) => Promise<{ success: boolean; name: string; error?: string }>;
    delete: (scope: 'user' | 'project', name: string, approvalToken: string, projectRoot?: string) => Promise<{ success: boolean; error?: string }>;
  };

  investigation: {
    read: (request: InvestigationReadRequest) => Promise<InvestigationReadIpcResult>;
  };

  plan: {
    read: (request: PlanReadRequest) => Promise<PlanReadResult>;
    issueApprovalToken: (request: PlanApprovalTokenRequest) => Promise<{ token?: string; targetPath?: string; cancelled?: boolean; error?: string }>;
    saveToProject: (request: PlanSaveToProjectRequest) => Promise<PlanSaveToProjectResult>;
    export: (request: PlanExportRequest) => Promise<PlanExportResult>;
  };

  knowledge: {
    overview: () => Promise<KnowledgeOverviewResult>;
    query: (request: KnowledgeQueryRequest) => Promise<KnowledgeQueryResult>;
    card: (spaceId: string, relativePath: string) => Promise<{ card: KnowledgeCardDetail | null }>;
    compile: (request: KnowledgeQueryRequest & { limit?: number }) => Promise<KnowledgePack>;
    indexRebuild: () => Promise<Pick<KnowledgeIndexOverview, 'revision' | 'builtAt' | 'cardCount'>>;
    candidates: (sessionId: string) => Promise<KnowledgeCandidatesResult>;
    candidateCreate: (request: {
      sessionId: string;
      card: KnowledgeCardRecord;
      explicitUserIntent: true;
    }) => Promise<SessionKnowledgeCandidate>;
    import: (request: {
      spaceId: string;
      sessionId?: string;
      source?: string;
      filePath?: string;
    }) => Promise<KnowledgeImportResult>;
    image: (request: {
      spaceId: string;
      relativePath: string;
    }) => Promise<{ dataUrl: string | null; error?: string }>;
    issueApprovalToken: (request: {
      action: 'knowledge.write' | 'knowledge.promote';
      spaceId: string;
      relativePath: string;
    }) => Promise<{ token?: string; error?: string }>;
    write: (request: {
      spaceId: string;
      card: KnowledgeCardRecord;
      permissionMode: AgentPermissionMode;
      confirmation: KnowledgeHumanConfirmation;
      approvalToken: string;
    }) => Promise<{ card: KnowledgeCardRecord }>;
    promote: (request: {
      spaceId: string;
      card: KnowledgeCardRecord;
      to: Extract<KnowledgeLifecycle, 'verified' | 'promoted' | 'deprecated'>;
      permissionMode: AgentPermissionMode;
      confirmation: KnowledgeHumanConfirmation;
      approvalToken: string;
    }) => Promise<{ card: KnowledgeCardRecord }>;
    export: (request: KnowledgeExportRequest) => Promise<KnowledgeExportResult>;
  };

  rdcRuntime: {
    getOverview: (projectRoot?: string) => Promise<RdcRuntimeOverview>;
    validateResource: (request: ScopedResourceWriteRequest) => Promise<{ valid: boolean; diagnostics: string[] }>;
    upsertResource: (request: ScopedResourceWriteRequest) => Promise<RdcRuntimeOverview>;
    importResource: (request: ScopedResourceImportRequest) => Promise<{ overview: RdcRuntimeOverview; id: string }>;
    deleteResource: (kind: ScopedResourceKind, scope: 'user' | 'project', id: string, projectRoot?: string) => Promise<RdcRuntimeOverview>;
    revealResource: (sourcePath: string) => Promise<{ success: boolean; error?: string }>;
    trustHook: (projectRoot: string | undefined | null, hookId: string) => Promise<RdcRuntimeOverview>;
    revokeHook: (projectRoot: string | undefined | null, hookId: string) => Promise<RdcRuntimeOverview>;
    trustMcp: (projectRoot: string, descriptorId: string) => Promise<RdcRuntimeOverview>;
    revokeMcp: (projectRoot: string, descriptorId: string) => Promise<RdcRuntimeOverview>;
    testHook: (event: HookEvent, projectRoot?: string, hookId?: string) => Promise<unknown>;
    listRequestSnapshots: (sessionId: string, turnId?: string) => Promise<RequestEnvelopeSnapshot[]>;
    getRequestSnapshot: (sessionId: string, turnId: string, snapshotId: string) => Promise<RequestEnvelopeSnapshot | null>;
  };

  command: {
    list: (category?: string) => Promise<CommandListResult>;
    execute: (request: CommandExecuteRequest) => Promise<{
      result: CommandResult;
      systemMessage?: import('./conversation').ConversationMessage;
    }>;
  };

  tool: {
    detectInstallations: () => Promise<import('./rdcInstallation').RdcInstallationCandidate[]>;
    resolveInstallation: (request: import('./rdcInstallation').RdcInstallationRequest) => Promise<import('./settings').RdcCliInvokerSettings>;
    verifyInstallation: (request: import('./rdcInstallation').RdcInstallationRequest) => Promise<{ settings: import('./settings').RdcCliInvokerSettings; summary: ToolRuntimeSummary }>;
    getCatalog: () => Promise<ToolCatalog>;
    getRuntimeSummary: () => Promise<ToolRuntimeSummary>;
  };

  mcp: {
    getStatusSummary: () => Promise<MCPServerStatusSummary[]>;
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
    testProviderDraft: (request: LlmProviderDraftRequest) => Promise<LlmProviderConnectionResult>;
    testModelCapability: (request: LlmModelCapabilityProbeRequest) => Promise<LlmModelCapabilityProbeResult>;
    connectProvider: (request: LlmProviderDraftRequest) => Promise<LlmProviderConnectionResult>;
    refreshProviderModels: (providerId: LlmProviderId) => Promise<LlmProviderConnectionResult>;
    disconnectProvider: (providerId: LlmProviderId) => Promise<LlmProviderConnectionResult>;
    startProviderAccountLogin: (request: LlmProviderAccountLoginStartRequest) => Promise<LlmProviderAccountStatus>;
    getProviderAccountStatus: (providerId: LlmProviderId) => Promise<LlmProviderAccountStatus>;
    finishProviderAccountLogin: (request: LlmProviderAccountLoginFinishRequest) => Promise<LlmProviderAccountStatus>;
    logoutProviderAccount: (providerId: LlmProviderId) => Promise<LlmProviderAccountStatus>;
  };

  settings: {
    get: () => Promise<AppSettings>;
    getProviderCatalog: () => Promise<LlmProviderCatalogResponse>;
    getEffectiveModel: (agentId: string) => Promise<EffectiveModel | null>;
    getEffectiveCatalog: (providerId: string, accountId?: string) => Promise<EffectiveCatalogSnapshot | null>;
    hasProviderSecret: (providerId: string) => Promise<{ hasSecret: boolean; maskedPreview?: string }>;
    importAgentManifest: (filePath: string) => Promise<AppSettings>;
    saveAgentDefinition: (request: AgentDefinitionSaveRequest) => Promise<AgentDefinitionSaveResult>;
    getAgentDefinitionCommit: (query: import('./agentManifest').AgentDefinitionCommitQuery) => Promise<AgentDefinitionCommitSnapshot | null>;
    saveProviderDefinition: (request: ProviderDefinitionSaveRequest) => Promise<ProviderDefinitionSaveResult>;
    getProviderDefinitionCommit: (providerId: string) => Promise<ProviderDefinitionCommitSnapshot | null>;
    getModelsOverride: () => Promise<ModelsOverride>;
    setModelsOverride: (overrides: ModelsOverride) => Promise<ModelsOverride>;
    getResolvedShell: (executable: string) => Promise<ResolvedShellSnapshot>;
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
      prepareRemove: (projectId: string, inputId: string) => Promise<import('./session').ProjectInputRemovePreparation>;
      remove: (projectId: string, inputId: string, approvalToken: string) => Promise<import('./session').ProjectInputRemoveResult>;
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
    watchStart: () => Promise<void>;
    watchRenew: () => Promise<void>;
    watchStop: () => Promise<void>;
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
    setModelOverride: (
      id: string,
      modelOverride: SessionRecord['modelOverride'],
    ) => Promise<{
      success: boolean;
      session?: SessionRecord;
      error?: string;
    }>;
    setAgentId: (
      id: string,
      agentId: string,
    ) => Promise<{
      success: boolean;
      session?: SessionRecord;
      error?: string;
    }>;
    applyDeclaredHandoff: (
      id: string,
      agent: string,
      label: string,
    ) => Promise<{
      success: boolean;
      session?: SessionRecord;
      suggestion?: PlanReviewHandoffSuggestion;
      error?: string;
    }>;

  };

  run: {
    list: (sessionId: string) => Promise<{ runs: RunSummary[] }>;
  };

  runtimeLog: {
    list: (request: { scope: RuntimeLogScope; sessionId?: string | null }) => Promise<{
      entries: RuntimeLogEntry[];
    }>;
  };

  capture: {
    getReplaySelection: (scope: SessionScope) => Promise<import('./captureReplay').CaptureReplaySelection | null>;
    listReplayHistory: (request: import('./captureReplay').CaptureReplayHistoryRequest) => Promise<{ entries: import('./captureReplay').CaptureReplayHistoryEntry[]; nextSequence?: number }>;
    readReplayImage: (request: SessionScope & { captureHash: string; imageHash: string }) => Promise<Uint8Array>;
    readLivePreview: (scope: SessionScope) => Promise<Uint8Array>;
    clearReplayHistory: (request: SessionScope & { captureHash: string }) => Promise<void>;
    getReplayState: (scope: SessionScope) => Promise<CaptureReplayState>;
    applyReplayEvent: (request: CaptureReplayApplyRequest) => Promise<CaptureReplayState>;
    refreshFrame: (scope: import('./captureReplay').CaptureReplayBindingRequest) => Promise<CaptureReplayState>;
    list: (scope: SessionScope) => Promise<{ captures: CaptureDescriptor[] }>;
    select: (request: SessionScope & { captureId: string; bindingGeneration: number }) => Promise<{
      success: boolean;
      error?: string;
    }>;
    openProjectInput: (
      request: Omit<OpenProjectInputRequest, 'replayDevice'> & { replayDeviceId: string; bindingGeneration: number }
    ) => Promise<{
      success: boolean;
      openedCapture?: OpenedCaptureState;
      contextSnapshot?: ContextSnapshot | null;
      error?: string;
    }>;
    getOpenedState: (scope: SessionScope) => Promise<OpenedCaptureState | null>;
    clearOpenedState: (scope: import('./captureReplay').CaptureReplayBindingRequest) => Promise<{
      success: boolean;
      error?: string;
    }>;
  };

  context: {
    get: (scope: SessionScope) => Promise<ContextSnapshot | null>;

  };

  trace: {
    getRun: (runId: string) => Promise<{ run: AgentRun | null }>;
    getEvents: (runId: string, afterSeq?: number) => Promise<{ events: TraceEvent[] }>;
    getProjection: (sessionId?: string) => Promise<TraceSessionResult>;
    exportRun: (runId: string) => Promise<{ run: AgentRun | null; events: TraceEvent[] }>;
    switchBranch: (sessionId: string, branchId: string) => Promise<TraceBranchSwitchResult>;
  };

  events: {
    onCaptureReplayChanged: (callback: (state: CaptureReplayState) => void) => () => void;
    onRunStatusChanged: (callback: (data: { runId: string; sessionId: string; status: RunSummary['status']; stopReason?: string }) => void) => () => void;
    onRunUsageChanged: (
      callback: (summary: SessionScopedPayload<RunContextUsageSummary>) => void
    ) => () => void;
    onTraceProjectionChanged: (callback: (payload: TraceProjectionChangedPayload) => void) => () => void;
    onEffectiveCatalogChanged: (callback: (snapshot: EffectiveCatalogSnapshot) => void) => () => void;
    onAgentMessage: (callback: (msg: unknown) => void) => () => void;
    onAgentStatusChanged: (callback: (state: AgentState) => void) => () => void;
    onToolExecutionComplete: (callback: (trace: unknown) => void) => () => void;
    onEvidenceEventAdded: (callback: (event: ActionEvent) => void) => () => void;
    onDeviceStatusChanged: (callback: (status: ReplayDeviceStatusChangedPayload) => void) => () => void;
    onCaptureStatusChanged: (callback: (status: SessionScopedPayload<unknown>) => void) => () => void;
    onContextChanged: (callback: (snapshot: SessionScopedPayload<ContextSnapshot | null>) => void) => () => void;
    onProjectInputsChanged: (callback: (payload: { projectId: string; inputs: ProjectInputRecord[] }) => void) => () => void;
    onProjectInputsError: (callback: (payload: { projectId: string; error: string }) => void) => () => void;
    onOpenedCaptureStateChanged: (callback: (state: SessionScopedPayload<OpenedCaptureState | null>) => void) => () => void;
    onRuntimeLogAppended: (callback: (entry: RuntimeLogEntry) => void) => () => void;
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

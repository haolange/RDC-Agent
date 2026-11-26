import type { ProviderProbeBatch, ProviderProbeBatchRequest } from './providerProbe';
import type { RendererEventChannel } from '../renderer-api/channels';
import type { CaptureReplayState, CaptureReplayApplyRequest } from './captureReplay';
import type { WorkflowState } from './workflow';
import type {
  AgentDefinitionCommitSnapshot,
  AgentDefinitionSaveRequest,
  AgentDefinitionSaveResult,
} from './agentManifest';
import type { ActionEvent } from './evidence';
import type {
  ConversationAccessAttachmentRequest,
  ConversationAccessAttachmentResult,
  ConversationCancelActiveTurnRequest,
  ConversationCancelActiveTurnResult,
  ConversationAnswerUserInputRequest,
  ConversationAnswerToolApprovalRequest,
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
import type { ReplayDeviceSnapshot, ReplayDeviceStatusChangedPayload } from './device';
import type { DevicePreparationRequest, DevicePreparationResult } from './captureReplay';
import type {
  PlanApprovalTokenRequest,
  PlanExportRequest,
  PlanExportResult,
  PlanReadRequest,
  PlanReadResult,
  PlanReviewProjection,
  PlanCancelReviewRequest,
  PlanReviewHandoffSuggestion,
  PlanSaveToProjectRequest,
  PlanSaveToProjectResult,
} from './planReview';
import type { EffectiveCatalogChange, EffectiveCatalogSnapshot, EffectiveModel } from './providerCapability';
import type { ModelsOverride } from '../provider-catalog/modelsOverrideSchema';
import type { RuntimeLogEntry, RuntimeLogScope } from './runtimeLog';
import type { RuntimePermissionState } from './runtimePermission';
import type {
  AgentPermissionMode,
  SettingsPatchOp,
  SettingsPatchResult,
  SettingsView,
  ResolvedShellSnapshot,
  LlmProviderAccountStatus,
  LlmProviderAccountLoginStartRequest,
  LlmProviderAccountLoginFinishRequest,
  LlmProviderCatalogResponse,
  LlmProviderConnectionResult,
  LlmProviderDraftRequest,
  LlmProviderId,
  LlmProviderProtocol,
  LlmModelCapabilityProbeRequest,
  LlmModelCapabilityProbeResult,
  ProviderDefinitionCommitSnapshot,
  ProviderDefinitionSaveRequest,
  ProviderDefinitionSaveResult,
  ResolvedTheme,
  SettingsChangedPayload,
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
  SessionModelWriteRequest,
  SessionRecordSnapshot,
  SessionScope,
  SessionScopedPayload,
} from './session';
import type { ToolRuntimeSummary, ToolTraceEntry } from './tool';
import type { MCPServerStatusSummary } from './mcp';
import type { CommandExecuteRequest, CommandListResult, CommandResult } from './command';
import type { TraceProjectionChangedPayload } from './agenticTrace';
import type { TraceSessionResult } from './trace';
import type { CrashFilesSummary, PreviousInstanceNotice, RendererFaultReport } from './lifecycle';
import type {
  HookEvent,
  RdcRuntimeOverview,
  RequestEnvelopeSnapshot,
  ScopedResourceImportRequest,
  ScopedResourceKind,
  ScopedResourceWriteRequest,
} from './rdcRuntime';
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
  KnowledgeTopicChanges,
  KnowledgeTopicPreview,
  KnowledgeTopicProposal,
  SessionKnowledgeCandidate,
} from './knowledge';
import type { KnowledgeExportRequest, KnowledgeExportResult } from './knowledgeExport';
import type { KnowledgeOperationProgress, KnowledgeOperationRef } from './knowledgeOperation';
import type { InvestigationReadIpcResult, InvestigationReadRequest } from './renderdocInvestigation';

/** Memory 面板列表项摘要（对应 MemoryRecord 的精简视图）。 */
/** `session:open`: the opened session with its history, trace projection and runs. */
export interface SessionOpenResult {
  session: SessionRecordSnapshot;
  currentRun: RunSummary | null;
  runs: RunSummary[];
  history: {
    messages: ConversationMessage[];
    planReview: PlanReviewProjection | null;
    branchState?: import('./conversationBranch').ConversationBranchState | null;
  };
  trace: TraceSessionResult;
}

interface MemorySummary {
  scope: 'user' | 'project';
  /** Canonical storage key; use displayName for user-facing text. */
  name: string;
  displayName: string;
  description: string;
  type: 'user' | 'feedback' | 'project' | 'reference';
  updatedAt: number;
}

/** Memory 面板详情（含完整正文）。 */
interface MemoryDetail extends MemorySummary {
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
interface MemoryApprovalTokenRequest {
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
      /** Set when the previous launch left its instance lock behind: how it most likely ended. */
      previousInstance: PreviousInstanceNotice | null;
    }>;
  };

  appShell: {
    selectAvatar: () => Promise<string | null>;
    getAvatarDataUrl: (avatarPath: string) => Promise<string | null>;
    openPath: (targetPath: string) => Promise<void>;
    copyText: (text: string) => Promise<{
      success: boolean;
    }>;
    readClipboardText: () => Promise<{
      success: boolean;
      text: string;
    }>;
    /** The minidumps kept on this machine; they are never uploaded or exported. */
    getCrashFiles: () => Promise<CrashFilesSummary>;
    /** Removes every kept minidump and returns what is left. */
    clearCrashFiles: () => Promise<CrashFilesSummary>;
    /** A render-time exception the root error boundary caught, for the lifecycle ledger. */
    reportRendererFault: (report: RendererFaultReport) => Promise<void>;
  };

  web: {
    resolveFavicon: (domain: string) => Promise<{
      dataUrl: string | null;
    }>;
    /** An https image an answer embeds, fetched by the main process (≤5 MB, sniffed raster types only). */
    /** `auto` loads only URLs a non-model source supplied in this session; `click` is the person asking (audited). */
    fetchImage: (request: {
      sessionId: string;
      url: string;
      intent: 'auto' | 'click';
    }) => Promise<{ dataUrl: string } | { dataUrl: null; error: string }>;
  };

  conversation: {
    sendMessage: (request: ConversationSendRequest) => Promise<ConversationSendResult>;
    rewriteFromMessage: (request: ConversationRewriteFromMessageRequest) => Promise<ConversationTurnResult>;
    cancelActiveTurn: (request?: ConversationCancelActiveTurnRequest) => Promise<ConversationCancelActiveTurnResult>;
    answerUserInput: (request: ConversationAnswerUserInputRequest) => Promise<void>;
    answerToolApproval: (request: ConversationAnswerToolApprovalRequest) => Promise<void>;
    answerPlanReview: (request: ConversationAnswerPlanReviewRequest) => Promise<ConversationAnswerPlanReviewResult>;
    getHistory: (sessionId: string) => Promise<{
      messages: ConversationMessage[];
      planReview: PlanReviewProjection | null;
      branchState?: import('./conversationBranch').ConversationBranchState | null;
    }>;
    /** The last streamed state of a message; `null` when it is not streaming (any more). */
    getMessageSnapshot: (
      sessionId: string,
      messageId: string,
    ) => Promise<{ seq: number; message: ConversationMessage } | null>;
    getDelegationTrace: (request: {
      sessionId: string;
      parentToolCallId: string;
      cursor: number;
      pageSize: number;
      sinceRevision?: number;
    }) => Promise<import('./delegationTrace').DelegationTracePage>;
    getDelegationContent: (
      request: import('./delegationTrace').DelegationContentRequest,
    ) => Promise<import('./delegationTrace').DelegationContentPage>;
    switchBranch: (
      request: import('./conversationBranch').ConversationSwitchBranchRequest,
    ) => Promise<import('./conversationBranch').ConversationSwitchBranchResult>;
    clearHistory: (sessionId: string) => Promise<{ messages: ConversationMessage[] }>;
    undoLastTurn: (sessionId: string) => Promise<{ messages: ConversationMessage[] }>;
    getToolImagePreview: (request: { sessionId: string; previewId: string }) => Promise<{
      dataUrl: string | null;
      error?: string;
    }>;
    stageAttachments: (request: ConversationStageAttachmentsRequest) => Promise<ConversationStageAttachmentsResult>;
    releaseAttachments: (
      request: ConversationReleaseAttachmentsRequest,
    ) => Promise<ConversationReleaseAttachmentsResult>;
    getAttachmentPreview: (
      request: ConversationGetAttachmentPreviewRequest,
    ) => Promise<ConversationGetAttachmentPreviewResult>;
    accessAttachment: (request: ConversationAccessAttachmentRequest) => Promise<ConversationAccessAttachmentResult>;
    /** A session artifact, attachment or project file an answer embeds; images and mp4/webm video only. */
    resolveMedia: (request: {
      sessionId: string;
      src: string;
    }) => Promise<{ dataUrl: string; kind: 'image' | 'video' } | { dataUrl: null; error: string }>;
    onEvent: (callback: (event: ConversationStreamEvent) => void) => void;
    offEvent: (callback: (event: ConversationStreamEvent) => void) => void;
  };

  selectFiles: () => Promise<string[] | null>;
  selectRdcFiles: () => Promise<string[] | null>;
  selectKnowledgeImport: () => Promise<string | null>;
  selectDirectory: () => Promise<string | null>;

  workflow: {
    getState: () => Promise<WorkflowState>;
    resume: (sessionId?: string) => Promise<void>;
    stop: (runId?: string) => Promise<void>;
    /**
     * 读取上下文用量快照。key 优先级：runId > sessionId > handler 内部 currentRunId。
     * sessionId 用于 Ask 模式（无 debug run，用量以 sessionId 为 store key）。
     */
    getRunUsage: (request: RunContextUsageRequest) => Promise<RunContextUsageReadResult>;
  };

  memory: {
    /** `cancelled` when the person declines main's confirmation dialog. */
    issueApprovalToken: (request: MemoryApprovalTokenRequest) => Promise<{ token: string } | { cancelled: true }>;
    list: (scope: 'user' | 'project', projectRoot?: string) => Promise<{ memories: MemorySummary[] }>;
    get: (scope: 'user' | 'project', name: string, projectRoot?: string) => Promise<{ memory: MemoryDetail | null }>;
    write: (request: MemoryWriteRequest) => Promise<{ name: string }>;
    /** `deleted` is false when no memory had that name. */
    delete: (
      scope: 'user' | 'project',
      name: string,
      approvalToken: string,
      projectRoot?: string,
    ) => Promise<{ deleted: boolean }>;
  };

  investigation: {
    list: (request: import('./trace').InvestigationListRequest) => Promise<import('./trace').InvestigationListPage>;
    read: (request: InvestigationReadRequest) => Promise<InvestigationReadIpcResult>;
  };

  plan: {
    reopenReview: (request: PlanReadRequest) => Promise<PlanReviewProjection>;
    cancelReview: (request: PlanCancelReviewRequest) => Promise<void>;
    read: (request: PlanReadRequest) => Promise<PlanReadResult>;
    /** `cancelled` when the person declines main's dialog. */
    issueApprovalToken: (
      request: PlanApprovalTokenRequest,
    ) => Promise<{ token: string; targetPath: string } | { cancelled: true }>;
    saveToProject: (request: PlanSaveToProjectRequest) => Promise<PlanSaveToProjectResult>;
    export: (request: PlanExportRequest) => Promise<PlanExportResult>;
  };

  knowledge: {
    overview: () => Promise<KnowledgeOverviewResult>;
    topicSuggest: () => Promise<KnowledgeTopicProposal>;
    topicPreview: (changes: KnowledgeTopicChanges) => Promise<KnowledgeTopicPreview>;
    topicApply: (request: {
      changes: KnowledgeTopicChanges;
      changeHash: string;
      confirmation: KnowledgeHumanConfirmation;
    }) => Promise<{ revision: string } | { cancelled: true }>;
    query: (request: KnowledgeQueryRequest) => Promise<KnowledgeQueryResult>;
    card: (spaceId: string, relativePath: string) => Promise<{ card: KnowledgeCardDetail | null }>;
    compile: (request: KnowledgeQueryRequest & { limit?: number }) => Promise<KnowledgePack>;
    indexRebuild: (
      request: KnowledgeOperationRef,
    ) => Promise<Pick<KnowledgeIndexOverview, 'revision' | 'builtAt' | 'cardCount'>>;
    candidates: (sessionId: string) => Promise<KnowledgeCandidatesResult>;
    candidateCreate: (request: {
      sessionId: string;
      card: KnowledgeCardRecord;
      explicitUserIntent: true;
    }) => Promise<SessionKnowledgeCandidate>;
    /** What importing this source would do, item by item; nothing is written and nothing asks for confirmation. */
    previewImport: (request: { spaceId: string; source?: string; filePath?: string }) => Promise<KnowledgeImportResult>;
    import: (
      request: KnowledgeOperationRef & {
        spaceId: string;
        source?: string;
        filePath?: string;
      },
    ) => Promise<KnowledgeImportResult | { cancelled: true }>;
    image: (request: { spaceId: string; relativePath: string }) => Promise<{ dataUrl: string | null; error?: string }>;
    issueApprovalToken: (request: {
      action: 'knowledge.write' | 'knowledge.promote';
      spaceId: string;
      card: KnowledgeCardRecord;
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
      to: Extract<KnowledgeLifecycle, 'verified' | 'promoted' | 'retired'>;
      permissionMode: AgentPermissionMode;
      confirmation: KnowledgeHumanConfirmation;
      approvalToken: string;
    }) => Promise<{ card: KnowledgeCardRecord }>;
    /** Main shows the save dialog; `null` when the person cancels it. */
    export: (request: KnowledgeExportRequest & KnowledgeOperationRef) => Promise<KnowledgeExportResult | null>;
    /** Stops a running import, export or rebuild between items; `false` when that operation already settled. */
    cancel: (request: KnowledgeOperationRef) => Promise<{ cancelled: boolean }>;
  };

  rdcRuntime: {
    getOverview: (projectRoot?: string) => Promise<RdcRuntimeOverview>;
    validateResource: (request: ScopedResourceWriteRequest) => Promise<{ valid: boolean; diagnostics: string[] }>;
    upsertResource: (request: ScopedResourceWriteRequest) => Promise<RdcRuntimeOverview>;
    /** `null` when the person cancels main's file picker. */
    importResource: (
      request: ScopedResourceImportRequest,
    ) => Promise<{ overview: RdcRuntimeOverview; id: string } | null>;
    deleteResource: (
      kind: ScopedResourceKind,
      scope: 'user' | 'project',
      id: string,
      projectRoot?: string,
    ) => Promise<RdcRuntimeOverview>;
    revealResource: (sourcePath: string) => Promise<void>;
    trustHook: (projectRoot: string | undefined | null, hookId: string) => Promise<RdcRuntimeOverview>;
    revokeHook: (projectRoot: string | undefined | null, hookId: string) => Promise<RdcRuntimeOverview>;
    trustMcp: (projectRoot: string, descriptorId: string) => Promise<RdcRuntimeOverview>;
    revokeMcp: (projectRoot: string, descriptorId: string) => Promise<RdcRuntimeOverview>;
    testHook: (event: HookEvent, projectRoot?: string, hookId?: string) => Promise<unknown>;
    listRequestSnapshots: (sessionId: string, turnId?: string) => Promise<RequestEnvelopeSnapshot[]>;
    getRequestSnapshot: (
      sessionId: string,
      turnId: string,
      snapshotId: string,
    ) => Promise<RequestEnvelopeSnapshot | null>;
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
    resolveInstallation: (
      request: import('./rdcInstallation').RdcInstallationRequest,
    ) => Promise<import('./settings').RdcCliInvokerSettings>;
    verifyInstallation: (
      request: import('./rdcInstallation').RdcInstallationRequest,
    ) => Promise<{ settings: import('./settings').RdcCliInvokerSettings; summary: ToolRuntimeSummary }>;
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
  };

  llm: {
    prepareProbeBatch: (request: ProviderProbeBatchRequest) => Promise<ProviderProbeBatch>;
    startProbeBatch: (runId: string) => Promise<ProviderProbeBatch>;
    cancelProbeBatch: (runId: string) => Promise<ProviderProbeBatch | null>;
    getProbeBatch: () => Promise<ProviderProbeBatch | null>;
    testProviderDraft: (request: LlmProviderDraftRequest) => Promise<LlmProviderConnectionResult>;
    testModelCapability: (request: LlmModelCapabilityProbeRequest) => Promise<LlmModelCapabilityProbeResult>;
    connectProvider: (request: LlmProviderDraftRequest) => Promise<LlmProviderConnectionResult>;
    refreshProviderModels: (
      providerId: LlmProviderId,
      scope?: { accountId: string; protocol: LlmProviderProtocol },
    ) => Promise<LlmProviderConnectionResult>;
    disconnectProvider: (providerId: LlmProviderId) => Promise<LlmProviderConnectionResult>;
    startProviderAccountLogin: (request: LlmProviderAccountLoginStartRequest) => Promise<LlmProviderAccountStatus>;
    getProviderAccountStatus: (providerId: LlmProviderId) => Promise<LlmProviderAccountStatus>;
    finishProviderAccountLogin: (request: LlmProviderAccountLoginFinishRequest) => Promise<LlmProviderAccountStatus>;
    cancelProviderAccountLogin: (providerId: LlmProviderId) => Promise<void>;
    logoutProviderAccount: (providerId: LlmProviderId) => Promise<LlmProviderAccountStatus>;
  };

  settings: {
    get: () => Promise<SettingsView>;
    getProviderCatalog: () => Promise<LlmProviderCatalogResponse>;
    getEffectiveModel: (agentId: string) => Promise<EffectiveModel | null>;
    getEffectiveCatalog: (providerId: string, accountId?: string) => Promise<EffectiveCatalogSnapshot | null>;
    hasProviderSecret: (providerId: string) => Promise<{ hasSecret: boolean; maskedPreview?: string }>;
    importAgentManifest: (filePath: string) => Promise<SettingsView>;
    saveAgentDefinition: (request: AgentDefinitionSaveRequest) => Promise<AgentDefinitionSaveResult>;
    getAgentDefinitionCommit: (
      query: import('./agentManifest').AgentDefinitionCommitQuery,
    ) => Promise<AgentDefinitionCommitSnapshot | null>;
    previewAgentOverrideFile: (sourcePath: string) => Promise<import('./agentManifest').AgentOverrideFilePreview>;
    deleteAgentOverrideFile: (request: import('./agentManifest').AgentOverrideFileRequest) => Promise<SettingsView>;
    previewProjectAgentTrust: (sourcePath: string) => Promise<import('./agentManifest').ProjectAgentTrustPreview>;
    trustProjectAgent: (request: import('./agentManifest').AgentOverrideFileRequest) => Promise<SettingsView>;
    getAgentBuiltinComparison: (
      query: import('./agentManifest').AgentDefinitionCommitQuery,
    ) => Promise<import('./agentManifest').AgentBuiltinComparison>;
    saveProviderDefinition: (request: ProviderDefinitionSaveRequest) => Promise<ProviderDefinitionSaveResult>;
    getProviderDefinitionCommit: (providerId: string) => Promise<ProviderDefinitionCommitSnapshot | null>;
    getModelsOverride: () => Promise<ModelsOverride>;
    setModelsOverride: (overrides: ModelsOverride) => Promise<ModelsOverride>;
    getResolvedShell: (executable: string) => Promise<ResolvedShellSnapshot>;
    /** Applies the ops in order and commits once; the result names only what changed. */
    patch: (ops: SettingsPatchOp[]) => Promise<SettingsPatchResult>;
  };

  project: {
    list: () => Promise<{ projects: ProjectRecord[] }>;
    add: (rootPath: string) => Promise<{ project: ProjectRecord }>;
    select: (projectId: string) => Promise<{
      project: ProjectRecord;
      currentSession: SessionRecordSnapshot | null;
      currentRun: RunSummary | null;
    }>;
    rename: (projectId: string, newName: string) => Promise<{ project: ProjectRecord }>;
    remove: (projectId: string) => Promise<void>;
    inputs: {
      referencePath: (projectId: string, filePath: string) => Promise<{ inputs: ProjectInputRecord[] }>;
      /** `null` when the person declines main's confirmation dialog. */
      prepareRemove: (
        projectId: string,
        inputId: string,
      ) => Promise<import('./session').ProjectInputRemovePreparation | null>;
      remove: (
        projectId: string,
        inputId: string,
        approvalToken: string,
      ) => Promise<import('./session').ProjectInputRemoveResult>;
      list: (projectId: string) => Promise<{ inputs: ProjectInputRecord[] }>;
      refresh: (projectId: string) => Promise<{ inputs: ProjectInputRecord[] }>;
      import: (projectId: string) => Promise<{ inputs: ProjectInputRecord[] }>;
      importPaths: (projectId: string, filePaths: string[]) => Promise<{ inputs: ProjectInputRecord[] }>;
    };
  };

  device: {
    prepare: (request: DevicePreparationRequest) => Promise<DevicePreparationResult>;
    cancelPreparation: (
      request: import('./captureReplay').CaptureReplayBindingRequest,
    ) => Promise<DevicePreparationResult>;
    list: () => Promise<ReplayDeviceSnapshot>;
    refresh: () => Promise<ReplayDeviceSnapshot>;
    watchStart: () => Promise<void>;
    watchRenew: () => Promise<void>;
    watchStop: () => Promise<void>;
  };

  session: {
    list: (projectId?: string) => Promise<{ sessions: SessionRecordSnapshot[] }>;
    create: (projectId: string, title?: string) => Promise<{ session: SessionRecordSnapshot }>;
    rename: (id: string, title: string) => Promise<{ session: SessionRecordSnapshot }>;
    remove: (id: string) => Promise<{ nextSession: SessionRecordSnapshot | null; nextRun: RunSummary | null }>;
    /** Makes the session current and returns what its surfaces show. */
    open: (id: string) => Promise<SessionOpenResult>;
    /** Sets the session's model override and/or turn controls on their revision lanes. */
    setModelOverride: (id: string, request: SessionModelWriteRequest) => Promise<{ session: SessionRecordSnapshot }>;
    setAgentId: (id: string, agentId: string) => Promise<{ session: SessionRecordSnapshot }>;
    applyDeclaredHandoff: (
      id: string,
      agent: string,
      label: string,
      expectedPlanHash?: string,
    ) => Promise<{ session: SessionRecordSnapshot; suggestion: PlanReviewHandoffSuggestion }>;
  };

  runtime: {
    getPermissionState: () => Promise<RuntimePermissionState>;
  };

  runtimeLog: {
    list: (request: { scope: RuntimeLogScope; sessionId?: string | null }) => Promise<{
      entries: RuntimeLogEntry[];
    }>;
  };

  capture: {
    getReplaySelection: (scope: SessionScope) => Promise<import('./captureReplay').CaptureReplaySelection | null>;
    readLivePreview: (scope: SessionScope) => Promise<Uint8Array>;
    getReplayState: (scope: SessionScope) => Promise<CaptureReplayState>;
    getRecovery: (scope: SessionScope) => Promise<import('./captureReplay').CaptureRecoveryStatus | null>;
    restorePrevious: (scope: import('./captureReplay').CaptureReplayBindingRequest) => Promise<CaptureReplayState>;
    applyReplayEvent: (request: CaptureReplayApplyRequest) => Promise<CaptureReplayState>;
    refreshFrame: (scope: import('./captureReplay').CaptureReplayBindingRequest) => Promise<CaptureReplayState>;
    list: (scope: SessionScope) => Promise<{ captures: CaptureDescriptor[] }>;
    select: (request: SessionScope & { captureId: string; bindingGeneration: number }) => Promise<void>;
    openProjectInput: (
      request: Omit<OpenProjectInputRequest, 'replayDevice'> & { replayDeviceId: string; bindingGeneration: number },
    ) => Promise<{ openedCapture: OpenedCaptureState; contextSnapshot: ContextSnapshot | null }>;
    getOpenedState: (scope: SessionScope) => Promise<OpenedCaptureState | null>;
    clearOpenedState: (scope: import('./captureReplay').CaptureReplayBindingRequest) => Promise<void>;
  };

  context: {
    get: (scope: SessionScope) => Promise<ContextSnapshot | null>;
  };

  trace: {
    getProjection: (sessionId?: string) => Promise<TraceSessionResult>;
  };

  events: {
    onCaptureReplayChanged: (callback: (state: CaptureReplayState) => void) => () => void;
    onRunStatusChanged: (
      callback: (data: { runId: string; sessionId: string; status: RunSummary['status']; stopReason?: string }) => void,
    ) => () => void;
    onRunUsageChanged: (callback: (summary: SessionScopedPayload<RunContextUsageSummary>) => void) => () => void;
    onTraceProjectionChanged: (callback: (payload: TraceProjectionChangedPayload) => void) => () => void;
    onDelegationTraceChanged: (
      callback: (payload: { sessionId: string; parentToolCallId: string; revision: number }) => void,
    ) => () => void;
    onProbeBatchChanged: (callback: (batch: ProviderProbeBatch) => void) => () => void;
    onKnowledgeProgress: (callback: (progress: KnowledgeOperationProgress) => void) => () => void;
    onEffectiveCatalogChanged: (callback: (change: EffectiveCatalogChange) => void) => () => void;
    onPlanReviewChanged: (callback: (projection: PlanReviewProjection) => void) => () => void;
    onSessionRecordChanged: (callback: (snapshot: SessionRecordSnapshot) => void) => () => void;
    onToolExecutionComplete: (callback: (trace: ToolTraceEntry) => void) => () => void;
    onEvidenceEventAdded: (callback: (event: ActionEvent) => void) => () => void;
    onDeviceStatusChanged: (callback: (status: ReplayDeviceStatusChangedPayload) => void) => () => void;
    onCaptureStatusChanged: (callback: (status: SessionScopedPayload<unknown>) => void) => () => void;
    onContextChanged: (callback: (snapshot: SessionScopedPayload<ContextSnapshot | null>) => void) => () => void;
    onProjectInputsChanged: (
      callback: (payload: { projectId: string; inputs: ProjectInputRecord[] }) => void,
    ) => () => void;
    onProjectInputsError: (callback: (payload: { projectId: string; error: string }) => void) => () => void;
    onOpenedCaptureStateChanged: (
      callback: (state: SessionScopedPayload<OpenedCaptureState | null>) => void,
    ) => () => void;
    onPermissionStateChanged: (callback: (state: RuntimePermissionState) => void) => () => void;
    onRuntimeLogAppended: (callback: (entry: RuntimeLogEntry) => void) => () => void;
    onSettingsChanged: (callback: (change: SettingsChangedPayload) => void) => () => void;
    onAppThemeChanged: (callback: (theme: ResolvedTheme) => void) => () => void;
    removeAllListeners: (channel: string) => void;
  };

  windowControls: {
    minimize: () => Promise<void>;
    toggleMaximize: () => Promise<boolean>;
    close: () => Promise<void>;
    isMaximized: () => Promise<boolean>;
  };

  on: (channel: RendererEventChannel, callback: (...args: unknown[]) => void) => void;
  off: (channel: RendererEventChannel, callback: (...args: unknown[]) => void) => void;
}

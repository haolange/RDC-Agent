/**
 * Session Types - Session 控制面板相关类型定义
 */

import type { ConversationTurnControls } from './modelCapability';
import type { ReplayDeviceEntry } from './device';

export type MissionId = 'debugger' | 'analyzer' | 'optimizer';
export type MissionKind = MissionId;
export type RunKind = 'conversation' | 'mission';

export interface ProjectInputRecord {
  inputId: string;
  fileName: string;
  filePath: string;
  source: 'project_resource';
  discoveredAt: number;
  lastModifiedAt: number;
  size: number;
  /** Absent until the original file has been successfully content-verified. */
  contentSha256?: string;
}

export interface ProjectInputRemovePreparation {
  success: boolean;
  approvalToken?: string;
  input?: ProjectInputRecord;
  affectedSessionIds?: string[];
  error?: string;
}
export interface ProjectInputRemoveResult {
  success: boolean;
  inputs: ProjectInputRecord[];
  fileDeleted?: boolean;
  cleanupPending?: boolean;
  error?: string;
}

export interface ProjectRecord {
  projectId: string;
  name: string;
  rootPath: string;
  slug: string;
  resourcePath: string;
  knowledgePath: string;
  inputsPath: string;
  inputs: ProjectInputRecord[];
  inputsUpdatedAt: number;
  replayCleanupPending?: { requestedAt: number; captureHashes: string[]; error?: string };
  createdAt: number;
  updatedAt: number;
  lastSessionId?: string;
}

export interface SessionModelOverride {
  providerId: string;
  modelId: string;
}

export interface SessionRecord {
  /** Main-derived migration notice; not a writable session field. */
  handoffNotice?: string;
  sessionId: string;
  projectId: string;
  title: string;
  goal: string;
  sessionPath: string;
  createdAt: number;
  updatedAt: number;
  lastRunId?: string;
  turnControls?: ConversationTurnControls;
  modelOverride?: SessionModelOverride | null;
  /** Current conversation Agent id. Missing means Composer pill hydrates to general. */
  agentId?: string;
}

/** Explicit project/session ownership for stateful RDX operations and events. */
export interface SessionScope {
  projectId: string;
  sessionId: string;
}

/** Every mutable RDX event carries its owning session; unowned state is never projected. */
export interface SessionScopedPayload<T> extends SessionScope {
  payload: T;
}

export type SessionAttachmentKind = 'image' | 'file';

export type SessionAttachmentLayer = 'image' | 'text' | 'pdf' | 'binary';

export interface SessionAttachmentRecord {
  material?: import('@shared/types/materialContext').MaterialContext;
  sourceHash?: string;
  attachmentId: string;
  sessionId: string;
  projectId: string;
  kind: SessionAttachmentKind;
  layer?: SessionAttachmentLayer;
  fileName: string;
  filePath: string;
  mimeType: string;
  size: number;
  createdAt: number;
}


export interface RunReportPaths {
  reportsDir: string;
  markdownPath?: string;
  jsonPath?: string;
  htmlPath?: string;
}

export interface CaptureInfo {
  id: string;
  filePath: string;
  fileName: string;
  fileSize: number;
  capturedAt: number;
  deviceId?: string;
}

export interface CaptureControl {
  captures: CaptureInfo[];
  activeCapture: string | null;
  isLoading: boolean;
}

export interface SessionContext {
  sessionId: string | null;
  caseId: string | null;
  startedAt: number | null;
  deviceId: string | null;
  replayContext: string | null;
  captureControl: CaptureControl;
}

export type CaptureRole = 'primary' | 'baseline' | 'reference' | 'fix';

export type ReplayBackendHint = 'local' | 'remote';

export interface CaptureDescriptor {
  id: string;
  filePath: string;
  captureFileId?: string;
  role: CaptureRole;
  backendHint: ReplayBackendHint;
  status: 'pending' | 'opening' | 'open' | 'error' | 'closed';
  ownerSessionId?: string | null;
  sessionId?: string;
  replaySessionId?: string;
  contextId?: string;
}

export interface DebugSessionStartRequest {
  projectId: string;
  sessionId?: string;
  turnId?: string;
  profileId: string;
  kind?: RunKind;
  mission?: MissionKind;
  goal: string;
  captures?: CaptureDescriptor[];
  primaryCaptureId?: string;
  replayDevice?: ReplayDeviceEntry | null;
}

export type RunStatus =
  | 'queued'
  | 'planning'
  | 'awaiting_input'
  | 'awaiting_approval'
  | 'running'
  | 'stopping'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

export interface RunRecordBase {
  schemaVersion: '3';
  runId: string;
  turnId?: string;
  projectId: string;
  sessionId: string;
  caseId: string;
  profileId: string;
  goal: string;
  captures: CaptureDescriptor[];
  startedAt: number;
  finishedAt?: number;
  stoppedAt?: number;
  status: RunStatus;
  stopReason?: string;
  backend: 'local' | 'remote';
  reportPaths?: RunReportPaths;
  diagnostics?: string[];
}

export interface ConversationRunRecord extends RunRecordBase {
  kind: 'conversation';
}

export interface MissionRunRecord extends RunRecordBase {
  kind: 'mission';
  mission: MissionKind;
}

export type RunRecord = ConversationRunRecord | MissionRunRecord;

export type RunSummary = RunRecord;

export type ContextUsageBreakdownId =
  | 'system_prompt'
  | 'memory_files'
  | 'skills'
  | 'system_tools'
  | 'mcp_tools'
  | 'mcp_tools_deferred'
  | 'builtin_tools_deferred'
  | 'subagent_definitions'
  | 'summarized_conversation'
  | 'conversation'
  | 'free';

export interface ContextUsageBreakdownEntry {
  id: ContextUsageBreakdownId;
  tokens: number;
  /** 可选附加计数，如工具数量、消息条数。 */
  count?: number;
}

export interface RunContextUsageSummary {
  runId: string;
  providerId: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Occupancy denominator: executable prompt/input budget for the selected tier. */
  promptBudgetTokens: number | null;
  /** Complete provider context window. */
  contextWindowTokens: number | null;
  /** Model max output from the active context tier; null when a legacy snapshot cannot recover it. */
  maxOutputTokens: number | null;
  /** Compaction trigger in tokens; null when a legacy snapshot cannot recover it. */
  compactionThresholdTokens: number | null;
  usagePercent: number;
  /** 最近一次 LLM 请求的 prompt 占用量（=provider 上报的 inputTokens），用于窗口占用率。 */
  occupiedTokens: number;
  /** 最近一次 prompt 的分类 token 估算；无 run 数据时为 null。 */
  breakdown: ContextUsageBreakdownEntry[] | null;
  /** 最近一次用量快照时间戳。 */
  snapshotAt: number | null;
  /** 本 run 累计 cache read tokens；provider 未上报时缺省。 */
  cacheReadTokens?: number;
  /** 本 run 累计 cache write tokens；provider 未上报时缺省。 */
  cacheWriteTokens?: number;
  /**
   * 本 run 累计 cache hit tokens（原生或由 cacheRead 归一化）。
   * 与 cacheMissTokens 成对出现；无 cache 遥测时缺省。可为 0。
   */
  cacheHitTokens?: number;
  /**
   * 本 run 累计 cache miss tokens。
   * 与 cacheHitTokens 成对出现；无 cache 遥测时缺省。可为 0。
   */
  cacheMissTokens?: number;
  /** 本 run 最近一次 LLM call 的 cache hit；无该轮遥测时缺省。 */
  lastTurnCacheHitTokens?: number;
  /** 本 run 最近一次 LLM call 的 cache miss；无该轮遥测时缺省。 */
  lastTurnCacheMissTokens?: number;
  /**
   * 缓存命中节省（= 本 run 累计 cacheHitTokens）。
   * 仅在有 cache 遥测时出现。
   */
  cacheSavedTokens?: number;
  /** 最近一轮命中率 0–100；分母为 0 时缺省。 */
  lastTurnCacheHitRate?: number;
  /** 本 run 累计命中率 0–100；分母为 0 时缺省。 */
  cumulativeCacheHitRate?: number;
  /** 本 run 累计 reasoning tokens；provider 未上报时缺省。 */
  reasoningTokens?: number;
  /**
   * 最近一次 LLM call 的成本明细（美元）。
   * 仅当模型有定价信息（manifest / models.json）时出现；无定价时缺省。
   */
  cost?: { input: number; output: number; cacheRead?: number; cacheWrite?: number; total: number };
  /** 本 run 累计成本（美元）；无定价遥测时缺省。 */
  cumulativeCost?: number;
}

export interface RunContextUsageRequest {
  sessionId: string;
  runId?: string;
}

export interface RunContextUsageReadResult {
  usage: RunContextUsageSummary | null;
  stale: boolean;
}

export interface PreparedTurnContextSummary {
  requestId: string;
  turnId: string;
  route: {
    providerId: string;
    adapterId: string;
    selectedModelId: string;
    effectiveModelId: string;
    protocol: string;
    catalogRevision: string;
    routeRevision: string;
    bindingIds: string[];
  };
  wirePatch: {
    headers: Record<string, string>;
    body: import('./providerCapability').JsonObject;
  };
  controls: import('./modelCapability').ConversationTurnControls;
  contextMode: 'normal' | 'one-million';
  preparedInputTokens: number;
  uncompactedInputTokens: number;
  promptBudgetTokens: number;
  contextWindowTokens: number;
  maxOutputTokens: number;
  compactionThresholdTokens: number;
  usagePercent: number;
  breakdown: ContextUsageBreakdownEntry[];
  compactionApplied: boolean;
  filteredArtifactCount: number;
  continuation: {
    executionFingerprint: string;
    strategy: import('./providerCapability').ContextTransitionStrategy;
    replayedArtifactCount: number;
    droppedArtifactCount: number;
    decisionCounts: Array<{ reason: string; count: number }>;
  };
  cache: {
    enabled: boolean;
    mode: import('./semanticContext').CompiledPromptCache['mode'];
    keyCarrier: import('./semanticContext').CompiledPromptCache['keyCarrier'];
    breakpointCarrier: import('./semanticContext').CompiledPromptCache['breakpointCarrier'];
    ttl: import('./semanticContext').CompiledPromptCache['ttl'];
    breakpoint: import('./semanticContext').CompiledPromptCache['breakpoint'];
    keyFingerprint?: string;
    stableTokenEstimate: number;
    stableSegmentCount: number;
    providerReported: boolean;
    reason: string;
  };
  preparedAt: number;
  runtimeDiagnostics?: string[];
}



export interface RdxRuntimeContext {
  contextId: string;
  runtimeOwner: string;
  ownerLeaseId: string;
  replaySessionId?: string;
  captureFileId?: string;
  captureId?: string;
  backend: 'local' | 'remote';
  deviceId?: string;
  deviceLabel?: string;
  remoteId?: string;
  remoteStatus?: 'connected' | 'online' | 'disconnected' | 'error';
  updatedAt: number;
  raw?: Record<string, unknown>;
}

export interface ContextSnapshot {
  contextId: string;
  sessionId: string;
  ownerSessionId?: string | null;
  backend: 'local' | 'remote';
  remoteStatus?: 'connected' | 'online' | 'disconnected' | 'error';
  runtimeOwner: string;
  ownerLeaseId: string;
  captureDescriptors: CaptureDescriptor[];
  activeCapture: string;
  deviceLabel: string;
  runtimeContext?: RdxRuntimeContext | null;
}

export interface OpenedCapturePreview {
  imagePath: string;
  imageUrl: string;
  width: number;
  height: number;
  source: 'framebuffer_screenshot' | 'capture_thumbnail';
  resolvedEventId?: number;
  presentEventId?: number;
  textureId?: string;
  targetSource?: string;
  targetSemantic?: string;
  fallbackReason?: string;
  summaryDegraded?: boolean;
  updatedAt: number;
}

export interface OpenedCapturePreviewAttempt {
  source: OpenedCapturePreview['source'];
  status: 'success' | 'failed';
  eventId?: number;
  message?: string;
  code?: string;
  imagePath?: string;
  resolvedEventId?: number;
  presentEventId?: number;
  textureId?: string;
  targetSource?: string;
  targetSemantic?: string;
  fallbackReason?: string;
  details?: unknown;
}

export interface OpenedCapturePreviewError {
  message: string;
  code?: string;
  attempts: OpenedCapturePreviewAttempt[];
}

export interface OpenedCaptureState {
  projectId: string;
  ownerSessionId: string | null;
  inputId: string;
  filePath: string;
  captureId: string;
  captureFileId?: string;
  sessionId: string;
  contextId: string;
  replaySessionId: string;
  backend: 'local' | 'remote';
  deviceId: string;
  deviceLabel: string;
  status: 'opening' | 'open' | 'error' | 'closed';
  openedAt: number;
  preview?: OpenedCapturePreview | null;
  previewError?: OpenedCapturePreviewError | null;
  previewAttempts?: OpenedCapturePreviewAttempt[];
  runtimeContext?: RdxRuntimeContext | null;
}

export interface OpenProjectInputRequest {
  projectId: string;
  sessionId: string;
  inputId: string;
  filePath: string;
  replayDevice: ReplayDeviceEntry;
}

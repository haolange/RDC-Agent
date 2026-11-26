import { z } from 'zod';
import { KNOWLEDGE_OPERATION_PHASES } from '../types/knowledgeOperation';
import { ActionEventSchema } from '../types/evidence';
import { ProjectInputRecordSchema, RunContextUsageSummarySchema } from '../types/session';
import type { RendererEventChannel } from './channels';
import type { AgentEvent, AgentEventType } from '../types/agentRuntime';
import type { AgentRunPresentation } from '../types/agenticTrace';
import type { CaptureReplayPhase, CaptureReplayState } from '../types/captureReplay';
import type { ConversationMessage, ConversationStreamEvent } from '../types/conversation';
import type { ConversationMessageDelta } from '../conversation/messageDelta';
import type { ReplayDeviceEntry, ReplayDeviceStatusChangedPayload } from '../types/device';
import type { PlanReviewProjection } from '../types/planReview';
import type { EffectiveCatalogChange, EffectiveModel, EffectiveModelValueChange } from '../types/providerCapability';
import type { ProviderProbeBatch, ProviderProbeBatchItem } from '../types/providerProbe';
import type { RuntimeLogEntry, RuntimeLogNamespace, RuntimeLogScope, RuntimeLogSeverity } from '../types/runtimeLog';
import type { RuntimePermissionState } from '../types/runtimePermission';
import type {
  ContextSnapshot,
  OpenedCaptureState,
  RunStatus,
  SessionRecord,
  SessionRecordSnapshot,
  SessionScopedPayload,
} from '../types/session';
import type {
  AgentPermissionMode,
  ResolvedTheme,
  SettingsChangedPayload,
  SettingsFileSection,
} from '../types/settings';
import type { ToolCallResult, ToolTraceEntry } from '../types/tool';

/** A zod enum of exactly the members of the string union `T`: a missing or unknown member fails to compile. */
const enumOf =
  <T extends string>() =>
  <const L extends readonly [T, ...T[]]>(values: L & ([T] extends [L[number]] ? unknown : never)) =>
    z.enum(values);

const isRecord = (value: unknown): boolean => typeof value === 'object' && value !== null && !Array.isArray(value);

/** A nested object main built and owns: only its being an object is checked here. */
const record = <T>() => z.custom<T>(isRecord);

/**
 * A payload whose body is too large to walk on every event: its routing fields are checked, the body is the object
 * main sent. The check visits only the listed fields, so its cost does not grow with the payload.
 */
const envelope = <T>(fields: z.ZodRawShape) => {
  const schema = z.object(fields);
  return z.custom<T>().superRefine((value, ctx) => {
    const parsed = schema.safeParse(value);
    if (!parsed.success)
      for (const issue of parsed.error.issues)
        ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
  });
};

const sessionScope = { projectId: z.string(), sessionId: z.string() };
const sessionScoped = <T>(payload: z.ZodType<T>): z.ZodType<SessionScopedPayload<T>> =>
  z.object({ ...sessionScope, payload });

const AGENT_EVENT_TYPES = enumOf<AgentEventType>()([
  'run.started',
  'assistant.delta',
  'assistant.text_end',
  'assistant.thinking_delta',
  'assistant.thinking_end',
  'assistant.completed',
  'tool.requested',
  'tool.started',
  'tool.progress',
  'tool.completed',
  'tool.denied',
  'task.created',
  'task.updated',
  'approval.requested',
  'approval.answered',
  'diagnostic',
  'run.completed',
  'run.failed',
  'run.cancelled',
  'context.compacted',
]);

const messageEnvelope = envelope<ConversationMessage>({ id: z.string(), turnId: z.string(), role: z.string() });

const MessageDeltaSchema: z.ZodType<ConversationMessageDelta> = z.object({
  messageId: z.string(),
  seq: z.number(),
  baseSeq: z.number(),
  fields: record<ConversationMessageDelta['fields']>(),
  removed: z.custom<NonNullable<ConversationMessageDelta['removed']>>((value) => Array.isArray(value)).optional(),
  trace: record<NonNullable<ConversationMessageDelta['trace']>>().nullable().optional(),
});

const streamScope = { sessionId: z.string(), turnId: z.string() };

/**
 * The hot path: one event per streamed update. Each event is checked by its envelope (type, session, turn, message id
 * and delta sequence); the message body and the delta's changed fields are main's structured output and are applied
 * by the assembler, which asks for a snapshot when a sequence does not line up.
 */
const ConversationStreamEventSchema: z.ZodType<ConversationStreamEvent> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('message_patched'), ...streamScope, message: messageEnvelope }),
  z.object({ type: z.literal('message_completed'), ...streamScope, message: messageEnvelope }),
  z.object({ type: z.literal('message_errored'), ...streamScope, message: messageEnvelope }),
  z.object({ type: z.literal('message_delta'), ...streamScope, delta: MessageDeltaSchema }),
  z.object({ type: z.literal('run_linked'), ...streamScope, runId: z.string() }),
  z.object({
    type: z.literal('agent_event'),
    ...streamScope,
    event: envelope<AgentEvent>({ id: z.string(), type: AGENT_EVENT_TYPES, timestamp: z.number(), payload: record() }),
  }),
]);

const PlanReviewProjectionSchema: z.ZodType<PlanReviewProjection> = z.object({
  sessionId: z.string(),
  projectionVersion: z.number(),
  review: record<NonNullable<PlanReviewProjection['review']>>().nullable(),
  recoverable: record<NonNullable<PlanReviewProjection['recoverable']>>().nullable(),
  approvedHandoff: record<NonNullable<PlanReviewProjection['approvedHandoff']>>().optional(),
  error: z.string().optional(),
  decision: z
    .object({ reviewId: z.string(), kind: enumOf<'approve' | 'reject' | 'cancel'>()(['approve', 'reject', 'cancel']) })
    .optional(),
});

const SessionRecordSnapshotSchema: z.ZodType<SessionRecordSnapshot> = z.object({
  record: envelope<SessionRecord>({ sessionId: z.string(), projectId: z.string() }),
  revision: z.object({ epoch: z.string(), n: z.number() }),
});

const RunStatusChangedSchema = z.object({
  runId: z.string(),
  sessionId: z.string(),
  status: enumOf<RunStatus>()([
    'queued',
    'planning',
    'awaiting_input',
    'awaiting_approval',
    'running',
    'stopping',
    'completed',
    'failed',
    'cancelled',
    'interrupted',
  ]),
  stopReason: z.string().optional(),
});

const EffectiveCatalogChangeSchema: z.ZodType<EffectiveCatalogChange> = z.object({
  base: z
    .object({ scopeGeneration: z.string(), projectionVersion: z.number(), catalogRevision: z.string() })
    .nullable(),
  snapshot: z.object({
    scopeGeneration: z.string(),
    projectionVersion: z.number(),
    providerId: z.string(),
    accountId: z.string(),
    catalogRevision: z.string(),
    generatedAt: z.string(),
    stale: z.boolean(),
    refreshing: z.boolean(),
    lastRefreshError: z.string().optional(),
  }),
  models: z.object({
    add: z.array(record<EffectiveModel>()),
    update: z.array(z.object({ modelId: z.string(), changes: z.array(record<EffectiveModelValueChange>()) })),
    remove: z.array(z.string()),
    order: z.array(z.string()).optional(),
  }),
});

const ProviderProbeBatchSchema: z.ZodType<ProviderProbeBatch> = z.object({
  id: z.string(),
  revision: z.number(),
  state: enumOf<ProviderProbeBatch['state']>()(['ready', 'running', 'cancelling', 'completed', 'cancelled']),
  items: z.array(record<ProviderProbeBatchItem>()),
  modelCount: z.number(),
  requestCount: z.number(),
  discoveryErrors: z.array(z.object({ providerId: z.string(), detail: z.string() })),
});

const ToolTraceEntrySchema: z.ZodType<ToolTraceEntry> = z.object({
  traceId: z.string(),
  turnId: z.string().optional(),
  toolName: z.string(),
  args: record<Record<string, unknown>>(),
  result: record<ToolCallResult>(),
  timestamp: z.number(),
  contextId: z.string(),
  runtimeOwner: z.string(),
  ownerLeaseId: z.string().optional(),
});

const ReplayDeviceStatusSchema: z.ZodType<ReplayDeviceStatusChangedPayload> = z.object({
  revision: z.number(),
  devices: z.array(record<ReplayDeviceEntry>()),
  discovery: z.object({
    status: enumOf<ReplayDeviceStatusChangedPayload['discovery']['status']>()(['idle', 'scanning', 'ready', 'failed']),
    error: z.string().optional(),
  }),
});

const CAPTURE_REPLAY_PHASES = enumOf<CaptureReplayPhase>()([
  'closed',
  'validating',
  'connecting',
  'transferring',
  'opening',
  'loading_image',
  'ready',
  'applying',
  'closing',
  'error',
]);

const RuntimeLogEntrySchema: z.ZodType<RuntimeLogEntry> = z.object({
  id: z.string(),
  timestamp: z.number(),
  scope: enumOf<RuntimeLogScope>()(['app', 'session']),
  namespace: enumOf<RuntimeLogNamespace>()(['system', 'agent', 'tool', 'device', 'capture', 'context', 'llm']),
  severity: enumOf<RuntimeLogSeverity>()(['info', 'success', 'warning', 'error']),
  title: z.string(),
  summary: z.string(),
  detail: z.string().optional(),
  sessionId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  runId: z.string().nullable().optional(),
  raw: z.unknown().optional(),
});

/**
 * What each channel main pushes must carry. The renderer API checks every payload against its channel's schema once,
 * before any listener runs, and hands the listener the object main sent; a payload that fails is dropped.
 */
export const RENDERER_EVENT_PAYLOAD = {
  'file:open': z.array(z.string()),
  'case:new': z.undefined(),
  'settings:open': z.undefined(),
  'app:themeChanged': enumOf<ResolvedTheme>()(['dark', 'light']),
  'window:maximized-changed': z.boolean(),
  'conversation:event': ConversationStreamEventSchema,
  'plan:reviewChanged': PlanReviewProjectionSchema,
  'conversation:delegationChanged': z.object({
    sessionId: z.string(),
    parentToolCallId: z.string(),
    revision: z.number(),
  }),
  'session:recordChanged': SessionRecordSnapshotSchema,
  'workflow:runStatusChanged': RunStatusChangedSchema,
  'workflow:runUsageChanged': sessionScoped(RunContextUsageSummarySchema),
  'trace:projectionChanged': z.object({
    ...sessionScope,
    presentation: envelope<AgentRunPresentation>({ projectId: z.string(), sessionId: z.string() }),
  }),
  'llm:effectiveCatalogChanged': EffectiveCatalogChangeSchema,
  'llm:probeBatchChanged': ProviderProbeBatchSchema,
  'knowledge:progress': z.object({
    operationId: z.string(),
    phase: z.enum(KNOWLEDGE_OPERATION_PHASES),
    done: z.number(),
    total: z.number(),
  }),
  'tool:executionComplete': ToolTraceEntrySchema,
  'evidence:eventAdded': ActionEventSchema,
  'device:statusChanged': ReplayDeviceStatusSchema,
  'capture:statusChanged': sessionScoped(z.unknown()),
  'context:changed': sessionScoped(
    envelope<ContextSnapshot>({ contextId: z.string(), sessionId: z.string() }).nullable(),
  ),
  'project:inputsChanged': z.object({ projectId: z.string(), inputs: z.array(ProjectInputRecordSchema) }),
  'project:inputsError': z.object({ projectId: z.string(), error: z.string() }),
  'capture:openedStateChanged': sessionScoped(
    envelope<OpenedCaptureState>({
      ...sessionScope,
      inputId: z.string(),
      captureId: z.string(),
      status: enumOf<OpenedCaptureState['status']>()(['opening', 'open', 'error', 'closed']),
    }).nullable(),
  ),
  'capture:replayChanged': envelope<CaptureReplayState>({
    ...sessionScope,
    generation: z.number(),
    revision: z.number(),
    phase: CAPTURE_REPLAY_PHASES,
  }),
  'runtime:logAppended': RuntimeLogEntrySchema,
  'runtime:permissionStateChanged': z.object({
    mode: enumOf<AgentPermissionMode>()(['default', 'auto-review', 'full-access', 'custom']),
    revision: z.number(),
  }) satisfies z.ZodType<RuntimePermissionState>,
  'settings:changed': z.object({
    revision: z.number(),
    sections: z.array(
      enumOf<SettingsFileSection>()([
        'appearance',
        'layout',
        'profile',
        'tooling',
        'agentRuntime',
        'agentModels',
        'providers',
        'globalInstructions',
      ]),
    ),
  }) satisfies z.ZodType<SettingsChangedPayload>,
} satisfies { [Channel in RendererEventChannel]: z.ZodType };

export type RendererEventPayload<Channel extends RendererEventChannel> = z.output<
  (typeof RENDERER_EVENT_PAYLOAD)[Channel]
>;

/**
 * Checks one pushed payload against its channel. A payload that fails is reported as a renderer console warning
 * (which main records with the renderer's console) naming the channel and the failing paths, never the values.
 */
export function acceptsEventPayload<Channel extends RendererEventChannel>(
  channel: Channel,
  payload: unknown,
): payload is RendererEventPayload<Channel> {
  const schema: z.ZodType = RENDERER_EVENT_PAYLOAD[channel];
  const parsed = schema.safeParse(payload);
  if (parsed.success) return true;
  const issues = parsed.error.issues.map(
    (issue) => `${issue.path.map(String).join('.') || '(payload)'}: ${issue.message}`,
  );
  console.warn(`[ipc-event] dropped an invalid ${channel} payload`, issues);
  return false;
}

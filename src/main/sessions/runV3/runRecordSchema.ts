import { z, type ZodType } from 'zod';
import { isMissionAgentId, LEGACY_UNKNOWN_PROFILE_ID } from '@shared/types/agent';
import type { MissionKind, RunRecord } from '@shared/types/session';
import type { PersistedRunRecord } from '../storageTypes';
import type { StorageMigration } from '../storageSchema';

const CaptureDescriptorSchema = z.object({
  id: z.string().min(1),
  filePath: z.string().min(1),
  captureFileId: z.string().optional(),
  role: z.enum(['primary', 'baseline', 'reference', 'fix']),
  backendHint: z.enum(['local', 'remote']),
  status: z.enum(['pending', 'opening', 'open', 'error', 'closed']),
  ownerSessionId: z.string().nullable().optional(),
  sessionId: z.string().optional(),
  replaySessionId: z.string().optional(),
  contextId: z.string().optional(),
}).passthrough();

const RunStatusSchema = z.enum([
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
]);

const RuntimeSchema = z.object({
  backend: z.enum(['local', 'remote']),
  entry_mode: z.enum(['cli', 'mcp']),
  context_id: z.string().nullable(),
  runtime_owner: z.string().nullable(),
  session_id: z.string().min(1),
}).strict();

const RunRecordBaseFields = {
  schemaVersion: z.literal('3'),
  runId: z.string().min(1),
  turnId: z.string().optional(),
  projectId: z.string().min(1),
  sessionId: z.string().min(1),
  caseId: z.string().min(1),
  profileId: z.string().min(1),
  goal: z.string(),
  captures: z.array(CaptureDescriptorSchema),
  startedAt: z.number(),
  finishedAt: z.number().optional(),
  stoppedAt: z.number().optional(),
  status: RunStatusSchema,
  stopReason: z.string().optional(),
  backend: z.enum(['local', 'remote']),
  reportPaths: z.unknown().optional(),
  diagnostics: z.array(z.string()).optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  runtime: RuntimeSchema,
};

const RUN_V3_STAGE_ERA_KEYS = [
  'lastStage',
  'last_stage',
  'workflow_stage',
  'recommendedSpecialists',
  'availableStages',
  'currentStage',
  'mode',
] as const;

function collectRunV3StageFields(record: Record<string, unknown>): string[] {
  const leftovers: string[] = [];
  for (const key of RUN_V3_STAGE_ERA_KEYS) {
    if (key in record) leftovers.push(key);
  }
  const runtime = record.runtime;
  if (runtime && typeof runtime === 'object' && !Array.isArray(runtime)) {
    const runtimeRecord = runtime as Record<string, unknown>;
    for (const key of RUN_V3_STAGE_ERA_KEYS) {
      if (key in runtimeRecord) leftovers.push(`runtime.${key}`);
    }
  }
  return leftovers;
}

export function assertNoRunV3StageFields(record: Record<string, unknown>, source: string): void {
  const leftovers = collectRunV3StageFields(record);
  if (leftovers.length === 0) return;
  throw new Error(
    `STORAGE: RUN_V3_STAGE_FIELD: ${source} must not carry ${leftovers.join(', ')}`,
  );
}

export const ConversationPersistedRunSchema = z.object({
  ...RunRecordBaseFields,
  kind: z.literal('conversation'),
  captures: z.array(CaptureDescriptorSchema).max(0),
}).strict();

export const MissionPersistedRunSchema = z.object({
  ...RunRecordBaseFields,
  kind: z.literal('mission'),
  mission: z.enum(['debugger', 'analyzer', 'optimizer']),
}).strict();

export const PersistedRunRecordV3Schema: ZodType<PersistedRunRecord> = z.discriminatedUnion('kind', [
  ConversationPersistedRunSchema,
  MissionPersistedRunSchema,
]).superRefine((value, ctx) => {
  if (value.kind === 'conversation') {
    if (isMissionAgentId(String(value.profileId))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'ConversationRun profileId cannot be a Mission identity.',
      });
    }
    return;
  }
  if (!isMissionAgentId(String(value.profileId))) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'MissionRun profileId must be debugger, analyzer, or optimizer.',
    });
  }
  if (value.mission !== value.profileId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'MissionRun mission must equal profileId.',
    });
  }
}) as unknown as ZodType<PersistedRunRecord>;

export interface RunProfileRecovery {
  profileId: string;
  diagnostics: string[];
}

export function classifyRunKind(profileId: string): { kind: RunRecord['kind']; mission?: MissionKind } {
  if (isMissionAgentId(profileId)) {
    return { kind: 'mission', mission: profileId };
  }
  return { kind: 'conversation' };
}

export function toPersistedRunV3(
  base: Omit<PersistedRunRecord, 'schemaVersion' | 'kind' | 'mission' | 'profileId' | 'diagnostics'> & {
    profileId: string;
    diagnostics?: string[];
    captures?: PersistedRunRecord['captures'];
  },
): PersistedRunRecord {
  const classified = classifyRunKind(base.profileId);
  const runtime = { ...base.runtime };
  assertNoRunV3StageFields({ ...(base as Record<string, unknown>), runtime }, 'toPersistedRunV3');
  const shared = {
    schemaVersion: '3' as const,
    runId: base.runId,
    turnId: base.turnId,
    projectId: base.projectId,
    sessionId: base.sessionId,
    caseId: base.caseId,
    profileId: base.profileId,
    goal: base.goal,
    captures: classified.kind === 'conversation' ? [] : (base.captures ?? []),
    startedAt: base.startedAt,
    finishedAt: base.finishedAt,
    stoppedAt: base.stoppedAt,
    status: base.status,
    stopReason: base.stopReason,
    backend: base.backend,
    reportPaths: base.reportPaths,
    diagnostics: base.diagnostics,
    createdAt: base.createdAt,
    updatedAt: base.updatedAt,
    runtime,
  };
  if (classified.kind === 'mission') {
    return { ...shared, kind: 'mission', mission: classified.mission! };
  }
  return { ...shared, kind: 'conversation' };
}

export const LEGACY_RUN_PROFILE_ID = LEGACY_UNKNOWN_PROFILE_ID;

function stampLegacyRun(raw: unknown, fromVersion: '0' | '1' | '2'): unknown {
  const record = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? { ...(raw as Record<string, unknown>) }
    : {};
  delete record.lastStage;
  delete record.last_stage;
  if (record.runtime && typeof record.runtime === 'object' && !Array.isArray(record.runtime)) {
    const runtime = { ...(record.runtime as Record<string, unknown>) };
    delete runtime.workflow_stage;
    record.runtime = runtime;
  }
  return {
    ...record,
    schemaVersion: '3',
    _legacyRunMigration: fromVersion,
  };
}

export const SESSION_RUN_MIGRATIONS: StorageMigration<PersistedRunRecord>[] = [
  {
    schemaVersion: '0',
    schema: z.object({}).passthrough() as unknown as ZodType<PersistedRunRecord>,
    migrate: (raw) => stampLegacyRun(raw, '0'),
  },
  {
    schemaVersion: '1',
    schema: z.object({}).passthrough() as unknown as ZodType<PersistedRunRecord>,
    migrate: (raw) => stampLegacyRun(raw, '1'),
  },
  {
    schemaVersion: '2',
    schema: z.object({}).passthrough() as unknown as ZodType<PersistedRunRecord>,
    migrate: (raw) => stampLegacyRun(raw, '2'),
  },
  {
    schemaVersion: '3',
    schema: PersistedRunRecordV3Schema,
  },
];

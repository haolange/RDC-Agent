import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { z, type ZodType } from 'zod';
import { delegationTextPreview } from '@shared/utils/delegationTextPreview';
import { AppError } from '@shared/errors/appError';
import { sessionRecordStore } from '../../sessions/store/sessionStores';
import { workflowProjectionPublisher } from '../orchestration/WorkflowProjectionPublisher';
import { parseJsonWith, readValidatedSync, writeFileAtomicSync } from '../../runtime/atomicFile';
import { safeDelegationText as safeText } from './DelegationTraceText';
import { finalizeTrace } from './ConversationWorkTrace';
import { createDelegatedProjectionState, projectDelegatedEvent, type DelegatedProjectionState } from './DelegatedWorkProjection';
import type { ConversationWorkBlock } from '@shared/types/conversation';
import type { DelegationContentKind, DelegationContentPage, DelegationTraceHeader, DelegationTracePage, DelegationTraceStep } from '@shared/types/delegationTrace';
import type { AgentEvent, AgentEventOf } from '@shared/types/agentRuntime';
import type { DelegationCapsule } from '../orchestration/delegationCapsule';

type TraceEntry =
  | { kind: 'start'; header: DelegationTraceHeader }
  | { kind: 'block'; step: DelegationTraceStep }
  | { kind: 'header'; header: DelegationTraceHeader };

interface ActiveTrace {
  identity: string;
  header: DelegationTraceHeader;
  projection: DelegatedProjectionState;
  blocks: Map<string, DelegationTraceStep>;
  pendingDelta?: AgentEventOf<'assistant.delta'>;
  pendingTimer?: ReturnType<typeof setTimeout>;
}

interface ParsedTrace {
  size: number;
  header: DelegationTraceHeader | null;
  order: string[];
  blocks: Map<string, DelegationTraceStep>;
  invalid: boolean;
}

const DelegationTraceHeaderSchema: ZodType<DelegationTraceHeader> = z.object({
  recordVersion: z.literal(2),
  sentPromptAvailable: z.boolean().optional(),
  parentToolCallId: z.string(),
  task: z.string(),
  taskLength: z.number(),
  taskAvailable: z.boolean(),
  invocationAvailable: z.boolean(),
  profile: z.string(),
  preparedRoute: z.object({ providerId: z.string(), modelId: z.string(), reasoningLevel: z.string() }).optional(),
  mode: z.enum(['wait', 'background']),
  executionId: z.string().optional(),
  generation: z.number().optional(),
  taskId: z.string().optional(),
  childSessionId: z.string(),
  status: z.enum(['running', 'complete', 'failed', 'cancelled', 'interrupted']),
  executionStatus: z.enum(['queued', 'running', 'waiting', 'cancelling', 'completed', 'partial', 'blocked', 'failed', 'cancelled', 'interrupted']).optional(),
  startedAt: z.number(),
  updatedAt: z.number(),
  completedAt: z.number().optional(),
  finalPreview: z.string().optional(),
  finalLength: z.number().optional(),
  finalAvailable: z.boolean().optional(),
  finalUnavailableReason: z.string().optional(),
  error: z.string().optional(),
  configurationError: z.enum(['MODEL_UNAVAILABLE', 'NO_USABLE_CONTEXT_TIER', 'PLAN_CONFLICT', 'CONSTRAINT_REJECTED',
    'AGENT_PROFILE_UNAVAILABLE', 'MODEL_ROUTE_REQUIRED', 'DELEGATION_REASONING_UNSUPPORTED']).optional(),
  parentReceiptPreview: z.string().optional(),
  parentReceiptAvailable: z.boolean().optional(),
  latestAction: z.string().optional(),
  latestActionStatus: z.enum(['pending', 'running', 'complete', 'error', 'skipped', 'cancelled']).optional(),
  total: z.number(),
  revision: z.number(),
});

/** A projected work block is written by this store from the delegated projection; its id keys the step. */
const TraceEntrySchema: ZodType<TraceEntry> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('start'), header: DelegationTraceHeaderSchema }),
  z.object({ kind: z.literal('header'), header: DelegationTraceHeaderSchema }),
  z.object({
    kind: z.literal('block'),
    step: z.object({
      id: z.string(),
      block: z.custom<ConversationWorkBlock>((value) => typeof value === 'object' && value !== null && !Array.isArray(value)),
      revision: z.number(),
    }),
  }),
]);
const HeadVersionSchema = z.object({ recordVersion: z.unknown().optional() });

/** The head of a current record; a record from another version is left as it is. */
function parseHead(value: unknown): DelegationTraceHeader {
  if (HeadVersionSchema.parse(value).recordVersion !== 2) throw new AppError('STORAGE_SCHEMA_UNSUPPORTED', 'delegation trace head is not recordVersion 2.');
  return DelegationTraceHeaderSchema.parse(value);
}

const MAX_BODY_BYTES = 8 * 1024 * 1024;
const PAGE_BYTES = 32_000;
const active = new Map<string, ActiveTrace>();
const activeExecutions = new Set<string>();
const parsed = new Map<string, ParsedTrace>();

function key(sessionId: string, callId: string): string { return `${sessionId}\u0000${callId}`; }
function identity(header: Pick<DelegationTraceHeader, 'childSessionId' | 'executionId' | 'generation'>): string {
  return `${header.childSessionId}\u0000${header.executionId ?? ''}\u0000${header.generation ?? ''}`;
}
const preview = delegationTextPreview;
function location(sessionId: string, callId: string): string | null {
  const session = sessionRecordStore.readSession(sessionId);
  if (!session) return null;
  return path.join(session.sessionPath, 'delegations', `${createHash('sha256').update(callId).digest('hex')}.jsonl`);
}
function headLocation(target: string): string { return `${target}.head.json`; }
function bodyLocation(target: string, kind: DelegationContentKind, stepId?: string): string {
  const id = `${kind}\u0000${stepId ?? ''}`;
  const name = createHash('sha256').update(id).digest('hex');
  return path.join(path.dirname(target), 'bodies', `${path.basename(target, '.jsonl')}-${name}.txt`);
}
function writeBody(target: string, kind: DelegationContentKind, text: string, stepId?: string): boolean {
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) return false;
  const file = bodyLocation(target, kind, stepId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
  return true;
}
function append(target: string, entry: TraceEntry): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.appendFileSync(target, `${JSON.stringify(entry)}\n`, 'utf8');
}
function saveHeader(target: string, header: DelegationTraceHeader, sessionId: string): void {
  header.updatedAt = Date.now();
  append(target, { kind: 'header', header });
  writeFileAtomicSync(headLocation(target), JSON.stringify(header));
  workflowProjectionPublisher.publish('conversation:delegationChanged', {
    sessionId, parentToolCallId: header.parentToolCallId, revision: header.revision,
  });
}
function parseEntry(trace: ParsedTrace, entry: TraceEntry, callId: string): void {
  if (entry.kind === 'start' || entry.kind === 'header') {
    if (entry.header.parentToolCallId !== callId) trace.invalid = true;
    else trace.header = entry.header;
  } else if (entry.kind === 'block') {
    if (!trace.blocks.has(entry.step.id)) trace.order.push(entry.step.id);
    trace.blocks.set(entry.step.id, entry.step);
  }
}
/** One journal line, or null when it is not a valid entry; the trace is then marked invalid, never repaired. */
function parseTraceEntry(line: string): TraceEntry | null {
  let value: unknown;
  try { value = JSON.parse(line); } catch { return null; }
  const entry = TraceEntrySchema.safeParse(value);
  return entry.success ? entry.data : null;
}
function readParsed(target: string, callId: string): ParsedTrace {
  const size = fs.statSync(target).size;
  let trace = parsed.get(target);
  if (!trace || size < trace.size) {
    trace = { size: 0, header: null, order: [], blocks: new Map(), invalid: false };
    parsed.delete(target);
    parsed.set(target, trace);
  }
  if (size > trace.size) {
    const bytes = Buffer.allocUnsafe(size - trace.size);
    const descriptor = fs.openSync(target, 'r');
    try { fs.readSync(descriptor, bytes, 0, bytes.length, trace.size); }
    finally { fs.closeSync(descriptor); }
    for (const line of bytes.toString('utf8').split('\n')) {
      if (!line) continue;
      const entry = parseTraceEntry(line);
      if (entry) parseEntry(trace, entry, callId);
      else trace.invalid = true;
    }
    trace.size = size;
  }
  parsed.delete(target);
  parsed.set(target, trace);
  if (parsed.size > 32) parsed.delete(parsed.keys().next().value!);
  return trace;
}
function currentHeader(sessionId: string, header: DelegationTraceHeader): DelegationTraceHeader {
  const ownerKey = key(sessionId, header.parentToolCallId);
  const executionLive = header.executionStatus === 'queued' || header.executionStatus === 'running'
    || header.executionStatus === 'waiting' || header.executionStatus === 'cancelling';
  return (header.mode === 'background' && executionLive && !activeExecutions.has(ownerKey))
    || (header.status === 'running' && !active.has(ownerKey) && !activeExecutions.has(ownerKey))
    ? { ...header, status: 'interrupted', executionStatus: header.mode === 'background' ? 'interrupted' : undefined,
      completedAt: header.updatedAt } : header;
}
function readHead(target: string, sessionId: string, callId: string): DelegationTraceHeader | null {
  const header = readValidatedSync(headLocation(target), parseJsonWith(parseHead));
  if (!header) return null;
  if (header.parentToolCallId !== callId) throw new AppError('DELEGATION_TRACE_ID_MISMATCH');
  return currentHeader(sessionId, header);
}
function updateLatestAction(record: ActiveTrace): void {
  const tools = record.projection.trace.blocks.flatMap(block => block.toolCalls);
  const tool = [...tools].reverse().find(item => item.status === 'running' || item.status === 'pending') ?? tools.at(-1);
  record.header.latestAction = tool?.toolName;
  record.header.latestActionStatus = tool?.status;
}

function persistBlocks(record: ActiveTrace, target: string): void {
  for (const block of record.projection.trace.blocks) {
    if (JSON.stringify(record.blocks.get(block.id)?.block) === JSON.stringify(block)) continue;
    const step = { id: block.id, block, revision: ++record.header.revision };
    record.blocks.set(block.id, step);
    append(target, { kind: 'block', step });
  }
  record.header.total = record.blocks.size;
  updateLatestAction(record);
}

function persistProjectedEvent(sessionId: string, record: ActiveTrace, target: string, event: AgentEvent): void {
  if (event.type === 'tool.completed') {
    writeBody(target, 'tool_receipt', safeText(event.payload.result), event.payload.toolCallId);
  }
  record.projection = projectDelegatedEvent(record.projection, event);
  const before = record.header.revision;
  persistBlocks(record, target);
  if (before === record.header.revision) return;
  saveHeader(target, record.header, sessionId);
}

function flushDelta(sessionId: string, record: ActiveTrace, target: string): void {
  if (record.pendingTimer) clearTimeout(record.pendingTimer);
  record.pendingTimer = undefined;
  const event = record.pendingDelta;
  record.pendingDelta = undefined;
  if (event) persistProjectedEvent(sessionId, record, target, event);
}

export const delegationTraceStore = {
  start(sessionId: string, input: Omit<DelegationTraceHeader, 'total' | 'revision' | 'updatedAt' | 'taskAvailable' | 'taskLength' | 'invocationAvailable' | 'recordVersion'> & { invocation: string }): void {
    const target = location(sessionId, input.parentToolCallId);
    if (!target) return;
    const existing = readHead(target, sessionId, input.parentToolCallId);
    if (existing && identity(existing) !== identity(input)) throw new AppError('DELEGATION_TRACE_ID_CONFLICT');
    if (existing) return;
    const task = safeText(input.task);
    const invocation = safeText(JSON.parse(input.invocation));
    const taskAvailable = false;
    const invocationAvailable = writeBody(target, 'invocation', invocation);
    const header: DelegationTraceHeader = { ...input, recordVersion: 2, task: preview(task), taskLength: task.length, taskAvailable,
      ...(input.mode === 'background' ? { executionStatus: 'running' as const } : {}),
      invocationAvailable, total: 0, revision: 0, updatedAt: Date.now() };
    delete (header as DelegationTraceHeader & { invocation?: string }).invocation;
    const record: ActiveTrace = { identity: identity(header), header,
      projection: createDelegatedProjectionState(), blocks: new Map() };
    active.set(key(sessionId, header.parentToolCallId), record);
    if (input.mode === 'background') activeExecutions.add(key(sessionId, header.parentToolCallId));
    append(target, { kind: 'start', header });
    saveHeader(target, header, sessionId);
  },
  updateTask(sessionId: string, callId: string, childIdentity: string, taskBody: DelegationTaskBody, sentPrompt: string): void {
    const record = active.get(key(sessionId, callId));
    const target = location(sessionId, callId);
    if (!record || record.identity !== childIdentity || !target) return;
    const text = safeText(taskBody);
    const taskAvailable = writeBody(target, 'task', text);
    record.header = { ...record.header, task: preview(safeText(taskBody.capsule.task || taskBody.capsule.goal)), taskLength: text.length,
      sentPromptAvailable: writeBody(target, 'sent_prompt', safeText(sentPrompt)), taskAvailable, revision: record.header.revision + 1 };
    saveHeader(target, record.header, sessionId);
  },
  setPreparedRoute(sessionId: string, callId: string, childIdentity: string, route: NonNullable<DelegationTraceHeader['preparedRoute']>): void {
    const record = active.get(key(sessionId, callId));
    const target = location(sessionId, callId);
    if (!record || record.identity !== childIdentity || !target) return;
    record.header = { ...record.header, preparedRoute: route, revision: record.header.revision + 1 };
    saveHeader(target, record.header, sessionId);
  },
  event(sessionId: string, callId: string, childIdentity: string, event: AgentEvent): void {
    const record = active.get(key(sessionId, callId));
    const target = location(sessionId, callId);
    if (!record || record.identity !== childIdentity || !target) return;
    if (event.type === 'assistant.delta') {
      const { payload } = event;
      if (!payload.text) return;
      const previous = record.pendingDelta?.payload;
      if (previous && (JSON.stringify(previous.providerOutputRef) !== JSON.stringify(payload.providerOutputRef)
        || previous.phase !== payload.phase)) flushDelta(sessionId, record, target);
      if (record.pendingDelta) {
        const queued = record.pendingDelta.payload;
        record.pendingDelta = { ...record.pendingDelta, payload: { ...queued, text: queued.text + payload.text } };
      } else record.pendingDelta = event;
      if (!record.pendingTimer) {
        record.pendingTimer = setTimeout(() => flushDelta(sessionId, record, target), 120);
        record.pendingTimer.unref?.();
      }
      return;
    }
    flushDelta(sessionId, record, target);
    persistProjectedEvent(sessionId, record, target, event);
  },
  finish(sessionId: string, callId: string, childIdentity: string, status: DelegationTraceHeader['status'], result: string,
    configurationError?: DelegationTraceHeader['configurationError']): void {
    const record = active.get(key(sessionId, callId));
    const target = location(sessionId, callId);
    if (!record || record.identity !== childIdentity || !target) return;
    flushDelta(sessionId, record, target);
    const completedAt = Date.now();
    record.projection.trace = finalizeTrace(record.projection.trace, status === 'complete' ? 'complete' : status === 'failed' || status === 'interrupted' ? 'error' : 'stopped', undefined, completedAt);
    persistBlocks(record, target);
    const text = safeText(result);
    const hasFinal = text.trim().length > 0;
      const finalAvailable = status === 'complete' && hasFinal && writeBody(target, 'final', text);
    record.header = { ...record.header, status, completedAt, revision: record.header.revision + 1,
      ...(status === 'complete' ? { finalPreview: preview(text), finalLength: text.length, finalAvailable,
        ...(!hasFinal || finalAvailable ? {} : { finalUnavailableReason: 'DELEGATION_CONTENT_LIMIT_EXCEEDED' }) }
        : { error: preview(text), ...(status === 'failed' && configurationError ? { configurationError } : {}) }) };
    saveHeader(target, record.header, sessionId);
    active.delete(key(sessionId, callId));
  },
  setExecutionStatus(sessionId: string, callId: string, childIdentity: string,
    status: NonNullable<DelegationTraceHeader['executionStatus']>): void {
    const target = location(sessionId, callId);
    if (!target || !fs.existsSync(headLocation(target))) return;
    const header = readHead(target, sessionId, callId);
    if (!header || header.mode !== 'background' || identity(header) !== childIdentity || header.executionStatus === status) return;
    if (header.executionStatus === 'completed' || header.executionStatus === 'partial' || header.executionStatus === 'blocked'
      || header.executionStatus === 'failed' || header.executionStatus === 'cancelled' || header.executionStatus === 'interrupted') return;
    const terminal = status === 'completed' || status === 'partial' || status === 'blocked'
      || status === 'failed' || status === 'cancelled' || status === 'interrupted';
    const next = { ...header, executionStatus: status, revision: header.revision + 1,
      ...(terminal ? { completedAt: Date.now() } : {}) };
    const record = active.get(key(sessionId, callId));
    if (record?.identity === childIdentity) record.header = next;
    saveHeader(target, next, sessionId);
    if (terminal) activeExecutions.delete(key(sessionId, callId));
  },
  setParentReceipt(sessionId: string, callId: string, result: unknown): void {
    const target = location(sessionId, callId);
    if (!target || !fs.existsSync(headLocation(target))) return;
    const header = readHead(target, sessionId, callId);
    if (!header) return;
    const text = safeText(result);
    const parentReceiptAvailable = writeBody(target, 'parent_receipt', text);
    saveHeader(target, { ...header, parentReceiptPreview: preview(text), parentReceiptAvailable,
      revision: header.revision + 1 }, sessionId);
  },
  read(sessionId: string, callId: string, cursor: number, pageSize = 40, sinceRevision?: number): DelegationTracePage {
    const target = location(sessionId, callId);
    const empty: DelegationTracePage = { header: null, steps: [], nextCursor: null, total: 0, revision: 0 };
    if (!target || !fs.existsSync(target)) return { ...empty, error: 'DELEGATION_TRACE_UNAVAILABLE' };
    try {
      const header = readHead(target, sessionId, callId);
      if (!header) return { ...empty, error: 'DELEGATION_TRACE_UNAVAILABLE' };
      if (pageSize === 0) return { header, steps: [], nextCursor: null, total: header.total, revision: header.revision };
      const trace = readParsed(target, callId);
      if (trace.invalid || trace.header?.childSessionId !== header.childSessionId
        || trace.header?.executionId !== header.executionId || trace.header?.generation !== header.generation) {
        return { ...empty, error: 'DELEGATION_TRACE_ID_MISMATCH' };
      }
      const source = sinceRevision === undefined ? trace.order : trace.order.filter((id) => (trace.blocks.get(id)?.revision ?? 0) > sinceRevision);
      const offset = Math.max(0, cursor);
      const ids = source.slice(offset, offset + Math.min(pageSize, 120));
      return { header, steps: ids.map((id) => {
        const step = trace.blocks.get(id)!;
        if (header.status !== 'interrupted') return step;
        const settled = finalizeTrace({ status: 'running', blocks: [step.block], updatedAt: header.updatedAt }, 'error', undefined, header.completedAt);
        return { ...step, block: settled.blocks[0]! };
      }).filter(Boolean),
        nextCursor: offset + ids.length < source.length ? offset + ids.length : null,
        total: header.total, revision: header.revision };
    } catch { return { ...empty, error: 'DELEGATION_TRACE_READ_FAILED' }; }
  },
  readContent(sessionId: string, callId: string,
    childIdentity: Pick<DelegationTraceHeader, 'childSessionId' | 'executionId' | 'generation'>,
    kind: DelegationContentKind, offset: number, stepId?: string): DelegationContentPage {
    const target = location(sessionId, callId);
    if (!target || !fs.existsSync(target)) throw new AppError('DELEGATION_CONTENT_DENIED');
    const header = readHead(target, sessionId, callId);
    if (!header || identity(header) !== identity(childIdentity)) throw new AppError('DELEGATION_CONTENT_DENIED');
    if (kind === 'tool_receipt') {
      if (!stepId) throw new AppError('DELEGATION_CONTENT_DENIED');
      const trace = readParsed(target, callId);
      if (trace.invalid || ![...trace.blocks.values()].some(({ block }) => block.toolCalls.some((call) => call.id === stepId))) {
        throw new AppError('DELEGATION_CONTENT_DENIED');
      }
    } else if ((kind === 'task' && !header.taskAvailable)
      || (kind === 'sent_prompt' && !header.sentPromptAvailable)
      || (kind === 'invocation' && !header.invocationAvailable)
      || (kind === 'final' && !header.finalAvailable)
      || (kind === 'parent_receipt' && !header.parentReceiptAvailable)) {
      throw new AppError('DELEGATION_CONTENT_UNAVAILABLE');
    }
    const file = bodyLocation(target, kind, stepId);
    if (!fs.existsSync(file)) throw new AppError('DELEGATION_CONTENT_UNAVAILABLE');
    const descriptor = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(descriptor).size;
      const start = Math.min(Math.max(offset, 0), size);
      const bytes = Buffer.allocUnsafe(Math.min(PAGE_BYTES, size - start));
      const count = fs.readSync(descriptor, bytes, 0, bytes.length, start);
      let length = count;
      let text = '';
      let decoded = count === 0;
      // Byte offsets avoid rereading long bodies. Never split a UTF-8 scalar between pages.
      for (let attempt = 0; attempt < 4 && length > 0; attempt += 1) {
        try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, length)); decoded = true; break; }
        catch { length -= 1; }
      }
      if (!decoded) throw new AppError('DELEGATION_CONTENT_INVALID_UTF8');
      const end = start + length;
      return { text, nextOffset: end < size ? end : null, total: size };
    } finally { fs.closeSync(descriptor); }
  },
};

export interface DelegationTaskBody {
  capsule: DelegationCapsule;
  completionRequirements: string[];
}

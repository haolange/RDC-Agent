import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { AgentEvent } from '@shared/types/agentRuntime';
import type { DelegationReceiptPage, DelegationTraceHeader, DelegationTracePage, DelegationTraceStep } from '@shared/types/delegationTrace';
import { storageAdapter } from '../sessions/StorageAdapter';
import { redactSecretsDeep, redactCredentialLikeText } from '../runtime/secretRedaction';
import { workflowProjectionPublisher } from '../workflow/debugger/WorkflowProjectionPublisher';

type TraceEntry =
  | { kind: 'start'; header: DelegationTraceHeader }
  | { kind: 'step'; step: DelegationTraceStep }
  | { kind: 'patch'; id: string; status: DelegationTraceStep['status']; completedAt: number; receipt?: string; receiptTruncated?: boolean; receiptRef?: string; eventId: string }
  | { kind: 'finish'; status: DelegationTraceHeader['status']; result: string; completedAt: number };

const MAX_RECEIPT = 16_000;
const MAX_TEXT = 8_000;
const MAX_RECEIPT_FILE = 1_048_576;
const active = new Map<string, string>();
interface ParsedTrace {
  size: number;
  header: DelegationTraceHeader | null;
  steps: DelegationTraceStep[];
  byId: Map<string, DelegationTraceStep>;
  invalid: boolean;
}
const parsed = new Map<string, ParsedTrace>();

function identity(header: Pick<DelegationTraceHeader, 'childSessionId' | 'executionId' | 'generation'>): string {
  return `${header.childSessionId}\u0000${header.executionId ?? ''}\u0000${header.generation ?? ''}`;
}

function activeKey(sessionId: string, parentToolCallId: string): string {
  return `${sessionId}\u0000${parentToolCallId}`;
}

function safeRawText(value: unknown): string {
  return redactCredentialLikeText(typeof value === 'string' ? value : JSON.stringify(redactSecretsDeep(value).value));
}

function safeText(value: unknown, limit: number): string {
  const text = safeRawText(value);
  return text.length > limit ? `${text.slice(0, limit)}\n… [truncated]` : text;
}

function location(sessionId: string, parentToolCallId: string): string | null {
  const session = storageAdapter.readSession(sessionId);
  if (!session) return null;
  const file = createHash('sha256').update(parentToolCallId).digest('hex') + '.jsonl';
  return path.join(session.sessionPath, 'delegations', file);
}

function append(sessionId: string, parentToolCallId: string, entry: TraceEntry): void {
  const target = location(sessionId, parentToolCallId);
  if (!target) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.appendFileSync(target, `${JSON.stringify(entry)}\n`, 'utf8');
  workflowProjectionPublisher.publish('conversation:delegationChanged', { sessionId, parentToolCallId });
}

function receiptLocation(sessionId: string, parentToolCallId: string, stepId: string): string | null {
  const trace = location(sessionId, parentToolCallId);
  if (!trace) return null;
  const name = createHash('sha256').update(`${parentToolCallId}\u0000${stepId}`).digest('hex') + '.txt';
  return path.join(path.dirname(trace), 'receipts', name);
}

function parseEntry(trace: ParsedTrace, entry: TraceEntry, parentToolCallId: string): void {
  if (entry.kind === 'start') {
    if (entry.header.parentToolCallId !== parentToolCallId) { trace.invalid = true; return; }
    trace.header = entry.header;
  } else if (entry.kind === 'step') {
    trace.steps.push(entry.step);
    trace.byId.set(entry.step.id, entry.step);
  } else if (entry.kind === 'patch') {
    const step = trace.byId.get(entry.id);
    if (step) Object.assign(step, { status: entry.status, completedAt: entry.completedAt, receipt: entry.receipt, receiptTruncated: entry.receiptTruncated, receiptRef: entry.receiptRef });
  } else if (entry.kind === 'finish' && trace.header) {
    trace.header = { ...trace.header, status: entry.status, result: entry.result, completedAt: entry.completedAt };
  }
}

function readParsed(target: string, parentToolCallId: string): ParsedTrace {
  const size = fs.statSync(target).size;
  let trace = parsed.get(target);
  if (!trace || size < trace.size) {
    trace = { size: 0, header: null, steps: [], byId: new Map(), invalid: false };
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
      parseEntry(trace, JSON.parse(line) as TraceEntry, parentToolCallId);
    }
    trace.size = size;
  }
  // A short bounded cache avoids repeatedly folding long running traces.
  parsed.delete(target);
  parsed.set(target, trace);
  if (parsed.size > 32) parsed.delete(parsed.keys().next().value!);
  return trace;
}

function readHeader(target: string, sessionId: string, parentToolCallId: string): DelegationTracePage {
  const size = fs.statSync(target).size;
  const descriptor = fs.openSync(target, 'r');
  try {
    const span = Math.min(size, 131_072);
    const first = Buffer.allocUnsafe(span);
    const firstLength = fs.readSync(descriptor, first, 0, span, 0);
    const firstLine = first.toString('utf8', 0, firstLength).split('\n', 1)[0];
    const start = JSON.parse(firstLine) as TraceEntry;
    if (start.kind !== 'start') return { header: null, steps: [], nextCursor: null, total: 0, error: 'DELEGATION_TRACE_MISSING_START' };
    if (start.header.parentToolCallId !== parentToolCallId) return { header: null, steps: [], nextCursor: null, total: 0, error: 'DELEGATION_TRACE_ID_MISMATCH' };
    const last = Buffer.allocUnsafe(span);
    const lastLength = fs.readSync(descriptor, last, 0, span, size - span);
    const lines = last.toString('utf8', 0, lastLength).trimEnd().split('\n');
    const end = JSON.parse(lines[lines.length - 1]) as TraceEntry;
    const header = end.kind === 'finish'
      ? { ...start.header, status: end.status, result: end.result, completedAt: end.completedAt }
      : start.header;
    return { header: currentHeader(sessionId, parentToolCallId, header), steps: [], nextCursor: null, total: 0 };
  } finally {
    fs.closeSync(descriptor);
  }
}

function currentHeader(sessionId: string, parentToolCallId: string, header: DelegationTraceHeader): DelegationTraceHeader {
  return header.status === 'running' && !active.has(activeKey(sessionId, parentToolCallId))
    ? { ...header, status: 'interrupted' }
    : header;
}

export const delegationTraceStore = {
  start(sessionId: string, header: DelegationTraceHeader): void {
    const key = activeKey(sessionId, header.parentToolCallId);
    const existing = this.read(sessionId, header.parentToolCallId, 0, 0).header;
    if (existing && identity(existing) !== identity(header)) throw new Error('DELEGATION_TRACE_ID_CONFLICT');
    active.set(key, identity(header));
    if (existing) return;
    append(sessionId, header.parentToolCallId, { kind: 'start', header: {
      ...header, task: safeText(header.task, MAX_TEXT), invocation: safeText(JSON.parse(header.invocation), MAX_RECEIPT),
    } });
  },
  event(sessionId: string, parentToolCallId: string, childIdentity: string, event: AgentEvent): void {
    if (active.get(activeKey(sessionId, parentToolCallId)) !== childIdentity) return;
    const timestamp = event.timestamp;
    if (event.type === 'tool.started') {
      const payload = event.payload as { toolCallId?: string; toolName?: string; args?: unknown };
      append(sessionId, parentToolCallId, { kind: 'step', step: {
        id: String(payload.toolCallId ?? event.id), kind: 'tool', status: 'running', timestamp,
        toolName: String(payload.toolName ?? 'tool'), args: safeText(payload.args ?? {}, MAX_RECEIPT), eventId: event.id,
      } });
    } else if (event.type === 'tool.completed' || event.type === 'tool.denied') {
      const payload = event.payload as { toolCallId?: string; result?: unknown; reason?: string };
      const stepId = String(payload.toolCallId ?? event.id);
      const fullReceipt = safeRawText(payload.result ?? payload.reason ?? {});
      const receipt = fullReceipt.length > MAX_RECEIPT ? `${fullReceipt.slice(0, MAX_RECEIPT)}\n… [truncated]` : fullReceipt;
      const target = fullReceipt.length > MAX_RECEIPT ? receiptLocation(sessionId, parentToolCallId, stepId) : null;
      if (target) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, fullReceipt.slice(0, MAX_RECEIPT_FILE), 'utf8');
      }
      append(sessionId, parentToolCallId, { kind: 'patch', id: stepId,
        status: event.type === 'tool.denied' || (payload.result as { ok?: boolean } | undefined)?.ok === false ? 'error' : 'complete',
        completedAt: timestamp, receipt, receiptTruncated: fullReceipt.length > MAX_RECEIPT_FILE,
        receiptRef: target ? stepId : undefined, eventId: event.id });
    } else if (event.type === 'assistant.completed') {
      const payload = event.payload as { text?: string; stopReason?: string };
      const text = safeText(payload.text ?? '', MAX_TEXT).trim();
      if (text && payload.stopReason !== 'end_turn') append(sessionId, parentToolCallId, { kind: 'step', step: {
        id: event.id, kind: 'message', status: 'complete', timestamp, text, eventId: event.id,
      } });
    } else if (event.type === 'diagnostic') {
      const payload = event.payload as { message?: string; userMessage?: string };
      append(sessionId, parentToolCallId, { kind: 'step', step: {
        id: event.id, kind: 'diagnostic', status: 'error', timestamp,
        text: safeText(payload.userMessage ?? payload.message ?? 'Execution diagnostic', MAX_TEXT), eventId: event.id,
      } });
    }
  },
  finish(sessionId: string, parentToolCallId: string, childIdentity: string, status: DelegationTraceHeader['status'], result: string): void {
    const key = activeKey(sessionId, parentToolCallId);
    if (active.get(key) !== childIdentity) return;
    active.delete(key);
    append(sessionId, parentToolCallId, { kind: 'finish', status, result: safeText(result, MAX_TEXT), completedAt: Date.now() });
  },
  read(sessionId: string, parentToolCallId: string, cursor: number, pageSize = 40): DelegationTracePage {
    const target = location(sessionId, parentToolCallId);
    if (!target || !fs.existsSync(target)) return { header: null, steps: [], nextCursor: null, total: 0 };
    if (pageSize === 0) return readHeader(target, sessionId, parentToolCallId);
    const trace = readParsed(target, parentToolCallId);
    if (trace.invalid) return { header: null, steps: [], nextCursor: null, total: 0, error: 'DELEGATION_TRACE_ID_MISMATCH' };
    if (!trace.header) return { header: null, steps: [], nextCursor: null, total: 0, error: 'DELEGATION_TRACE_MISSING_START' };
    const offset = Math.max(0, cursor);
    const page = trace.steps.slice(offset, offset + pageSize).map((step) => ({ ...step }));
    return { header: currentHeader(sessionId, parentToolCallId, trace.header), steps: page,
      nextCursor: offset + page.length < trace.steps.length ? offset + page.length : null, total: trace.steps.length };
  },
  readReceipt(sessionId: string, parentToolCallId: string, stepId: string, offset: number): DelegationReceiptPage {
    const traceTarget = location(sessionId, parentToolCallId);
    if (!traceTarget || !fs.existsSync(traceTarget)) throw new Error('DELEGATION_RECEIPT_DENIED');
    const trace = readParsed(traceTarget, parentToolCallId);
    if (trace.invalid || trace.byId.get(stepId)?.receiptRef !== stepId) throw new Error('DELEGATION_RECEIPT_DENIED');
    const target = receiptLocation(sessionId, parentToolCallId, stepId);
    if (!target) throw new Error('DELEGATION_RECEIPT_DENIED');
    const content = fs.readFileSync(target, 'utf8');
    const start = Math.min(Math.max(offset, 0), content.length);
    const end = Math.min(start + 32_000, content.length);
    return { text: content.slice(start, end), nextOffset: end < content.length ? end : null, total: content.length };
  },
};

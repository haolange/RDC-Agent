import { createHash } from 'node:crypto';
import { SessionArtifactError, SESSION_ARTIFACT_MAX_FILE_BYTES, isSessionArtifactizedEnvelope } from '@shared/types/sessionArtifact';
import { sessionContextJournal, type SessionContextJournal } from '../conversation/SessionContextJournal';
import { canonicalJson } from '../tools/RdcOperationCatalog';
import { containsSensitiveRequestKey } from '../tools/RdcInvocationRecord';
import { delegatedArtifactOwner } from './DelegatedArtifactAccess';
import { sessionArtifactResolver, type SessionArtifactResolver } from './SessionArtifactResolver';
import type { ToolExecutionContext } from '../agent-runtime/agent/AgentTool';
import { storageAdapter } from './StorageAdapter';

export type RecordedRequestQualification = 'recorded-model-request-only' | 'recorded-operation-index-only';
interface RecordedRdcDeps {
  resolver: Pick<SessionArtifactResolver, 'read' | 'write'>;
  journal: Pick<SessionContextJournal, 'readEntries'>;
  history?: Pick<typeof storageAdapter, 'readConversationHistory'>;
}

const digest = (value: unknown): string => createHash('sha256').update(canonicalJson(value)).digest('hex');
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const fail = (reason: string): never => { throw new SessionArtifactError('ARTIFACT_REQUEST_UNAVAILABLE', reason); };
function experimentField(request: Record<string, unknown>): { experimentId?: string } {
  if (!('experimentId' in request)) return {};
  if (typeof request.experimentId !== 'string') return fail('Recorded experiment id is invalid.');
  return { experimentId: request.experimentId };
}

/** Own-session recorded requests are provenance, not proof of native execution/defaults. */
export function materializeRecordedRdcRequest(
  context: ToolExecutionContext, uri: string, expectedHash: string | undefined,
  deps: RecordedRdcDeps = { resolver: sessionArtifactResolver, journal: sessionContextJournal, history: storageAdapter },
  operationIndex = false,
): { uri: string; hash: string; qualification: RecordedRequestQualification } {
  const sessionId = context.sessionId;
  if (!sessionId || context.agentId !== 'general' || context.excludeRdcLeaseTools || delegatedArtifactOwner(sessionId)) {
    throw new SessionArtifactError('ARTIFACT_SESSION_DENIED', 'Recorded request lookup requires the owning root General; child grants do not grant journal access.');
  }
  if (!expectedHash) throw new SessionArtifactError('ARTIFACT_HASH_REQUIRED', 'Recorded request lookup requires the original output hash.');
  if (!uri.startsWith('session://tool-outputs/')) fail('Only a native RDC tool-output reference is eligible.');
  let text = ''; let cursor: { offset: number; column: number } = { offset: 1, column: 0 };
  let sourceHash = '';
  for (let pages = 0; ; pages += 1) {
    if (pages >= 256) fail('Output pagination exceeded the bounded lookup limit.');
    const page = deps.resolver.read(sessionId, uri, { ...cursor, expectedHash });
    if (page.mimeType !== 'application/json' || page.bytes > SESSION_ARTIFACT_MAX_FILE_BYTES) fail('Output is not a bounded JSON artifact.');
    sourceHash = page.hash; text += page.text ?? '';
    if (Buffer.byteLength(text) > SESSION_ARTIFACT_MAX_FILE_BYTES) fail('Output exceeds the bounded lookup size.');
    if (!page.next) { if (page.truncated) fail('Incomplete output pagination.'); break; }
    if (page.next.offset === cursor.offset && page.next.column === cursor.column) fail('Output pagination did not advance.');
    cursor = page.next;
  }
  let envelope: unknown;
  try {
    envelope = JSON.parse(text);
    const outer = object(envelope);
    if (outer?.encoding === 'json-chunks') {
      if (!Array.isArray(outer.chunks) || !outer.chunks.every(chunk => typeof chunk === 'string')) fail('Invalid output chunks.');
      envelope = JSON.parse((outer.chunks as string[]).join(''));
    }
  } catch { return fail('Invalid JSON output envelope.'); }
  if (!isSessionArtifactizedEnvelope(envelope) || envelope.owner !== sessionId || envelope.source.toolName !== 'shell') fail('Output owner/source is not the owning native shell.');
  const output = envelope as import('@shared/types/sessionArtifact').SessionArtifactizedEnvelope;
  const details = object(output.details);
  const content = Array.isArray(output.content) ? output.content : [];
  const block = content.find(item => object(item)?.type === 'text');
  let payload: Record<string, unknown> | null;
  try { payload = object(JSON.parse(String(object(block)?.text))); } catch { return fail('Missing native result envelope.'); }
  const native = object(payload?.result); const identity = object(payload?.rdcExecutionIdentity);
  const operation = details?.operation;
  if (typeof operation !== 'string' || !/^rd\.[a-z_]+\.[a-z0-9_]+$/.test(operation)
    || native?.result_kind !== operation || identity?.productSessionId !== sessionId
    || !identity.contextId || !identity.replaySessionId || !identity.captureFileId
    || canonicalJson(identity) !== canonicalJson(details?.rdcExecutionIdentity)) fail('Output lacks matching main-owned native identity and operation.');
  if (operationIndex) return materializeOperationIndex(sessionId, String(operation), { uri, hash: sourceHash, toolCallId: output.source.toolCallId }, deps, context.turnId);
  const candidates = deps.journal.readEntries(sessionId).flatMap(entry => entry.messages.flatMap(message => {
    if (message.role !== 'assistant') return [];
    return message.content.flatMap(block => {
      if (block.type !== 'toolCall' || block.id !== output.source.toolCallId) return [];
      const request = object(block.arguments.rdc);
      if (!request) throw new SessionArtifactError('ARTIFACT_REQUEST_UNAVAILABLE', 'Recorded call is not a structured RDC request.');
      if (block.name !== 'shell' || request?.operation !== operation || !object(request.args)) fail('Recorded tool call does not match the native output operation.');
      return [{ request: { operation, args: request.args, ...experimentField(request) }, turnId: entry.turnId, branchId: entry.branchId,
        messageTimestamp: message.timestamp, executionFingerprint: entry.executionIdentity.fingerprint }];
    });
  }));
  if (!candidates.length) fail('Original request is unavailable in the owning session journal; no alternate source or native re-execution is used.');
  const fingerprint = digest(candidates[0].request);
  if (candidates.some(candidate => digest(candidate.request) !== fingerprint)) {
    throw new SessionArtifactError('ARTIFACT_REQUEST_CONFLICT', 'Conflicting recorded requests share this tool call id.');
  }
  if (containsSensitiveRequestKey(candidates[0].request)) fail('Recorded request contains sensitive argument keys and cannot be published.');
  const witness = { kind: 'recorded-model-rdc-request', qualification: 'recorded-model-request-only',
    warning: 'Requested arguments from the durable session journal. Not native execution/default resolution, a signed experiment receipt, or current replay evidence.',
    outcome: { uri, hash: sourceHash, source: output.source, rdcExecutionIdentity: identity },
    request: candidates[0].request, requestFingerprint: fingerprint,
    sources: candidates.map(({ request: _request, ...source }) => source) };
  const witnessUri = `session://tool-outputs/recorded-request-${digest(witness)}.json`;
  const written = deps.resolver.write(sessionId, witnessUri, JSON.stringify(witness, null, 2));
  return { uri: written.uri, hash: written.hash, qualification: 'recorded-model-request-only' };
}

function materializeOperationIndex(sessionId: string, operation: string, anchor: { uri: string; hash: string; toolCallId: string }, deps: RecordedRdcDeps, activeTurnId?: string) {
  if (!deps.history) return fail('Canonical conversation coverage metadata is unavailable.');
  const entries = deps.journal.readEntries(sessionId);
  const toolFingerprints = new Map<string, string>();
  const rows = new Map<string, { toolCallId: string; operation: string; request: Record<string, unknown>; argumentsShape: string; requestFingerprint: string;
    sources: Array<{ turnId: string; branchId: string; messageTimestamp: number; executionFingerprint: string }>;
    recordedReturns: Array<{ turnId: string; isError: boolean; artifact?: { uri: string; hash: string } }> }>();
  for (const entry of entries) for (const message of entry.messages) {
    if (message.role !== 'assistant') continue;
    for (const block of message.content) {
      if (block.type !== 'toolCall' || block.name !== 'shell') continue;
      const request = object(block.arguments.rdc);
      if (request?.operation !== operation) continue;
      if (containsSensitiveRequestKey(request)) return fail('A matching recorded request has sensitive arguments; no partial index is published.');
      const requestFingerprint = digest(request);
      const argumentsShape = !('args' in request) ? 'missing' : request.args === null ? 'null' : Array.isArray(request.args) ? 'array' : typeof request.args;
      const previous = rows.get(block.id);
      if (previous && previous.requestFingerprint !== requestFingerprint) throw new SessionArtifactError('ARTIFACT_REQUEST_CONFLICT', 'Conflicting recorded requests share a tool call id; no index published.');
      const row = previous ?? { toolCallId: block.id, operation, request, argumentsShape, requestFingerprint, sources: [], recordedReturns: [] };
      row.sources.push({ turnId: entry.turnId, branchId: entry.branchId, messageTimestamp: message.timestamp, executionFingerprint: entry.executionIdentity.fingerprint });
      rows.set(block.id, row);
      if (!toolFingerprints.has(block.id)) toolFingerprints.set(block.id, digest({ name: block.name, arguments: block.arguments }));
    }
  }
  for (const entry of entries) for (const message of entry.messages) {
    if (message.role === 'assistant') {
      for (const block of message.content) if (block.type === 'toolCall' && rows.has(block.id)
        && toolFingerprints.get(block.id) !== digest({ name: block.name, arguments: block.arguments })) {
        throw new SessionArtifactError('ARTIFACT_REQUEST_CONFLICT', 'A matching call id was reused for a different tool request; no index published.');
      }
      continue;
    }
    if (message.role !== 'toolResult' || message.toolName !== 'shell') continue;
    const row = rows.get(message.toolCallId);
    if (!row) continue;
    const details = object(message.details);
    const ref = object(details?.evidenceArtifact) ?? details;
    const source = object(ref?.source);
    const artifact = ref?.owner === sessionId && source?.toolCallId === row.toolCallId && source.toolName === 'shell'
      && typeof ref.ref === 'string' && ref.ref.startsWith('session://tool-outputs/') && typeof ref.hash === 'string' && /^[a-f0-9]{64}$/i.test(ref.hash)
      ? { uri: ref.ref, hash: ref.hash } : undefined;
    row.recordedReturns.push({ turnId: entry.turnId, isError: message.isError, ...(artifact ? { artifact } : {}) });
  }
  const turns = new Set(entries.map(entry => entry.turnId));
  const historyTurns = [...new Set(deps.history.readConversationHistory(sessionId).map(message => message.turnId).filter((id): id is string => typeof id === 'string' && !!id))];
  const witness = { kind: 'recorded-model-rdc-operation-index', qualification: 'recorded-operation-index-only', operation, anchor,
    warning: 'All matching structured shell.rdc requests in this committed session journal snapshot, not a complete native execution inventory. Legacy/unstructured shell, other tools and UI lifecycle calls are excluded. Recorded returns and artifact references require independent outcome verification. Uncommitted/interrupted calls, unmeasured fields and native defaults cannot be reconstructed.',
    coverage: { requestShape: 'shell.rdc.operation', journalEntryCount: entries.length, conversationTurnCount: historyTurns.length,
      conversationTurnsMissingJournal: historyTurns.filter(id => id !== activeTurnId && !turns.has(id)),
      excludedActiveTurnId: activeTurnId ?? null, anchorRequestPresent: rows.has(anchor.toolCallId), matchingUniqueToolCallCount: rows.size },
    requests: [...rows.values()] };
  const written = deps.resolver.write(sessionId, `session://tool-outputs/recorded-operation-index-${digest(witness)}.json`, JSON.stringify(witness, null, 2));
  return { uri: written.uri, hash: written.hash, qualification: 'recorded-operation-index-only' as const };
}

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SessionArtifactResolver } from './SessionArtifactResolver';
import { resolveDelegatedArtifactRead } from './DelegatedArtifactAccess';
import type { SessionContextTurnEntry } from '../conversation/SessionContextJournal';
import type { ToolExecutionContext } from '../agent-runtime/agent/AgentTool';
import { grantDelegatedArtifactAccess } from './DelegatedArtifactAccess';
vi.mock('./StorageAdapter', () => ({ storageAdapter: {} }));
vi.mock('../conversation/SessionContextJournal', () => ({ sessionContextJournal: {} }));
import { materializeRecordedRdcRequest } from './RecordedRdcRequest';

const hash = 'a'.repeat(64);
const uri = 'session://tool-outputs/call.json';
const identity = { productSessionId: 'parent', contextId: 'native', replaySessionId: 'replay', captureFileId: 'capture' };
const operation = 'rd.debug.get_variables';
const context: ToolExecutionContext = { sessionId: 'parent', projectId: 'p', workspaceRoot: '/ws', projectRootPath: '/ws', agentId: 'general' };
const entry = (args: Record<string, unknown> = { shader_debug_id: 'handle', max_variables: 1 }): SessionContextTurnEntry => ({
  schemaVersion: 2, turnId: 'turn', branchId: 'branch', executionIdentity: { fingerprint: 'execution' } as SessionContextTurnEntry['executionIdentity'],
  userMessageId: 'user', assistantMessageId: 'assistant', agentId: 'general', controls: { reasoningLevel: 'off', maxContextMode: false, fastModel: false }, status: 'complete', createdAt: 123, completedAt: 124,
  messages: [{ role: 'assistant', timestamp: 123, model: 'test', provider: 'test', stopReason: 'toolUse', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, content: [{ type: 'toolCall', id: 'call', name: 'shell', arguments: { rdc: { operation, args } } }] }],
});
const envelope = () => ({ owner: 'parent', ownerScope: 'product-session', source: { toolName: 'shell', toolCallId: 'call' },
  hash, size: 100, mime: 'application/json', details: { operation, rdcExecutionIdentity: identity },
  content: [{ type: 'text', text: JSON.stringify({ result: { result_kind: operation, data: { variables: [] } }, rdcExecutionIdentity: identity }) }] });
const read = vi.fn(); const write = vi.fn(); const readEntries = vi.fn();
const deps = { resolver: { read, write }, journal: { readEntries } };
beforeEach(() => {
  vi.clearAllMocks();
  read.mockReturnValue({ uri, hash, mimeType: 'application/json', bytes: 100, text: JSON.stringify(envelope()), truncated: false });
  write.mockImplementation((_session, target) => ({ uri: target, hash: 'b'.repeat(64) }));
  readEntries.mockReturnValue([entry()]);
});
describe('recorded RDC requests', () => {
  it('indexes only the anchor operation, deduplicates replayed calls and exposes missing journal turns without declaring native coverage', () => {
    const first = entry();
    first.messages.push({ role: 'toolResult', toolCallId: 'call', toolName: 'shell', isError: false, timestamp: 124, content: [],
      details: { evidenceArtifact: { ref: uri, hash, owner: 'parent', source: { toolName: 'shell', toolCallId: 'call' } } } });
    const second = entry({ shader_debug_id: 'second' }); second.turnId = 'second';
    if (second.messages[0].role === 'assistant' && second.messages[0].content[0].type === 'toolCall') second.messages[0].content[0].id = 'second-call';
    second.messages.push({ role: 'toolResult', toolCallId: 'second-call', toolName: 'shell', isError: true, timestamp: 124, content: [],
      details: { ref: 'session://tool-outputs/private.json', hash, owner: 'other', source: { toolName: 'shell', toolCallId: 'second-call' } } });
    const other = entry({ api_key: 'private unrelated request' });
    if (other.messages[0].role === 'assistant' && other.messages[0].content[0].type === 'toolCall') { other.messages[0].content[0].id = 'other-call'; other.messages[0].content[0].arguments = { rdc: { operation: 'rd.debug.finish', args: {} } }; }
    readEntries.mockReturnValue([first, { ...entry(), turnId: 'replayed' }, second, other]);
    const history = { readConversationHistory: vi.fn().mockReturnValue([{ turnId: 'turn' }, { turnId: 'second' }, { turnId: 'interrupted' }, { turnId: 'active' }]) };
    const result = materializeRecordedRdcRequest({ ...context, turnId: 'active' }, uri, hash, { ...deps, history }, true);
    const index = JSON.parse(write.mock.calls[0][2]);
    expect(result.qualification).toBe('recorded-operation-index-only');
    expect(history.readConversationHistory).toHaveBeenCalledWith('parent');
    expect(index.coverage).toEqual({ requestShape: 'shell.rdc.operation', journalEntryCount: 4, conversationTurnCount: 4, conversationTurnsMissingJournal: ['interrupted'], excludedActiveTurnId: 'active', anchorRequestPresent: true, matchingUniqueToolCallCount: 2 });
    expect(index.requests[0]).toMatchObject({ toolCallId: 'call', request: { args: { shader_debug_id: 'handle' } }, argumentsShape: 'object',
      recordedReturns: [{ isError: false, artifact: { uri, hash } }] });
    expect(index.requests[0].sources).toHaveLength(2);
    expect(index.requests[1].recordedReturns).toEqual([{ turnId: 'second', isError: true }]);
    expect(index.warning).toContain('not a complete native execution inventory');
    expect(write.mock.calls[0][2]).not.toContain('private unrelated request');
  });
  it.each(['coverage-unavailable', 'conflict', 'sensitive', 'experiment-conflict', 'operation-conflict', 'tool-conflict'])(
    'fails closed for an operation index with %s', mode => {
      if (mode === 'conflict') readEntries.mockReturnValue([entry(), entry({ shader_debug_id: 'different' })]);
      if (mode === 'operation-conflict' || mode === 'tool-conflict') {
        const other = entry();
        if (other.messages[0].role === 'assistant' && other.messages[0].content[0].type === 'toolCall') {
          if (mode === 'operation-conflict') other.messages[0].content[0].arguments = { rdc: { operation: 'rd.debug.finish', args: {} } };
          else other.messages[0].content[0].name = 'read_file';
        }
        readEntries.mockReturnValue([entry(), other]);
      }
      if (mode === 'sensitive') readEntries.mockReturnValue([entry({ credential: 'private' })]);
      if (mode === 'experiment-conflict') {
        const e = entry();
        if (e.messages[0].role === 'assistant' && e.messages[0].content[0].type === 'toolCall') {
          e.messages[0].content[0].arguments = { rdc: { operation, args: { shader_debug_id: 'handle', max_variables: 1 }, experimentId: 'other-experiment' } };
        }
        readEntries.mockReturnValue(mode === 'experiment-conflict' ? [entry(), e] : [e]);
      }
      const history = mode === 'coverage-unavailable' ? undefined : { readConversationHistory: vi.fn().mockReturnValue([]) };
      expect(() => materializeRecordedRdcRequest(context, uri, hash, { ...deps, history }, true)).toThrow(/ARTIFACT_REQUEST_(UNAVAILABLE|CONFLICT)/);
      expect(write).not.toHaveBeenCalled();
    },
  );
  it.each(['missing', 'null', 'array', 'string'])(
    'preserves %s args and failed returns as recorded requests without claiming valid native invocation', shape => {
      const e = entry();
      const request = { operation, ...(shape === 'missing' ? {} : { args: shape === 'null' ? null : shape === 'array' ? [1] : 'invalid' }) };
      if (e.messages[0].role === 'assistant' && e.messages[0].content[0].type === 'toolCall') e.messages[0].content[0].arguments = { rdc: request };
      e.messages.push({ role: 'toolResult', toolCallId: 'call', toolName: 'shell', isError: true, timestamp: 124, content: [] });
      readEntries.mockReturnValue([e]);
      materializeRecordedRdcRequest(context, uri, hash, { ...deps, history: { readConversationHistory: vi.fn().mockReturnValue([]) } }, true);
      const row = JSON.parse(write.mock.calls[0][2]).requests[0];
      expect(row).toMatchObject({ request, argumentsShape: shape, recordedReturns: [{ isError: true }] });
    },
  );
  it('keeps a real index hash-bound, separate from its anchor and outside any old child grant', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-recorded-index-'));
    try {
      fs.writeFileSync(path.join(root, 'session.json'), '{}');
      const resolver = new SessionArtifactResolver({ resolveSessionPath: id => id === 'parent' ? root : null });
      const original = JSON.stringify({ encoding: 'json-chunks', chunks: [JSON.stringify(envelope())] });
      const saved = resolver.write('parent', uri, original);
      const indexDeps = { resolver, journal: { readEntries }, history: { readConversationHistory: vi.fn().mockReturnValue([]) } };
      const index = materializeRecordedRdcRequest(context, uri, saved.hash, indexDeps, true);
      expect(JSON.parse(resolver.read('parent', index.uri, { expectedHash: index.hash }).text!).coverage.matchingUniqueToolCallCount).toBe(1);
      expect(resolver.read('parent', uri, { expectedHash: saved.hash }).text).toBe(original);
      const release = grantDelegatedArtifactAccess('index-child', 'parent', [uri], resolver);
      try {
        expect(() => resolveDelegatedArtifactRead('index-child', index.uri)).toThrow('ARTIFACT_SESSION_DENIED');
        expect(() => materializeRecordedRdcRequest({ ...context, sessionId: 'index-child' }, uri, saved.hash, indexDeps, true)).toThrow('ARTIFACT_SESSION_DENIED');
      } finally { release(); }
      expect(() => materializeRecordedRdcRequest({ ...context, excludeRdcLeaseTools: true }, uri, saved.hash, indexDeps, true)).toThrow('ARTIFACT_SESSION_DENIED');
      expect(() => materializeRecordedRdcRequest(context, uri, '0'.repeat(64), indexDeps, true)).toThrow('ARTIFACT_HASH_MISMATCH');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  it('preserves recorded experiment linkage and rejects invalid experiment ids instead of merging them', () => {
    const e = entry();
    if (e.messages[0].role === 'assistant' && e.messages[0].content[0].type === 'toolCall') e.messages[0].content[0].arguments = { rdc: { operation, args: {}, experimentId: 'experiment' } };
    readEntries.mockReturnValue([e]);
    materializeRecordedRdcRequest(context, uri, hash, deps);
    expect(JSON.parse(write.mock.calls[0][2]).request.experimentId).toBe('experiment');
    if (e.messages[0].role === 'assistant' && e.messages[0].content[0].type === 'toolCall') e.messages[0].content[0].arguments = { rdc: { operation, args: {}, experimentId: 123 } };
    expect(() => materializeRecordedRdcRequest(context, uri, hash, deps)).toThrow('ARTIFACT_REQUEST_UNAVAILABLE');
  });
  it('binds real artifact bytes, preserves the original, and requires an explicit grant to read the new witness', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-recorded-request-'));
    try {
      fs.writeFileSync(path.join(root, 'session.json'), '{}');
      const resolver = new SessionArtifactResolver({ resolveSessionPath: id => id === 'parent' ? root : null });
      const original = JSON.stringify({ encoding: 'json-chunks', chunks: [JSON.stringify(envelope())] });
      const saved = resolver.write('parent', uri, original);
      const witness = materializeRecordedRdcRequest(context, uri, `sha256:${saved.hash}`, { resolver, journal: { readEntries } });
      expect(resolver.read('parent', uri, { expectedHash: saved.hash }).text).toBe(original);
      expect(JSON.parse(resolver.read('parent', witness.uri, { expectedHash: witness.hash }).text!).request.args.shader_debug_id).toBe('handle');
      expect(() => materializeRecordedRdcRequest(context, uri, '0'.repeat(64), { resolver, journal: { readEntries } })).toThrow('ARTIFACT_HASH_MISMATCH');
      const releaseOriginal = grantDelegatedArtifactAccess('audit-child', 'parent', [uri], resolver);
      try { expect(() => resolveDelegatedArtifactRead('audit-child', witness.uri)).toThrow('ARTIFACT_SESSION_DENIED'); }
      finally { releaseOriginal(); }
      const releaseWitness = grantDelegatedArtifactAccess('audit-child', 'parent', [witness.uri], resolver);
      try {
        const scope = resolveDelegatedArtifactRead('audit-child', witness.uri);
        expect(resolver.read(scope.sessionId, witness.uri, { expectedHash: scope.expectedHash }).hash).toBe(witness.hash);
        expect(() => materializeRecordedRdcRequest({ ...context, sessionId: 'audit-child' }, uri, saved.hash, { resolver, journal: { readEntries } })).toThrow('ARTIFACT_SESSION_DENIED');
      } finally { releaseWitness(); }
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  it('writes separate qualified provenance without changing the native result, preserving exact args and source identity', () => {
    const result = materializeRecordedRdcRequest(context, uri, hash, deps);
    expect(read).toHaveBeenCalledWith('parent', uri, expect.objectContaining({ expectedHash: hash }));
    expect(result.qualification).toBe('recorded-model-request-only');
    const witness = JSON.parse(write.mock.calls[0][2]);
    expect(witness).toMatchObject({ request: { operation, args: { shader_debug_id: 'handle', max_variables: 1 } },
      outcome: { uri, hash, rdcExecutionIdentity: identity }, sources: [{ turnId: 'turn', branchId: 'branch', messageTimestamp: 123, executionFingerprint: 'execution' }] });
    expect(write.mock.calls[0][1]).not.toBe(uri);
    expect(witness.warning).toContain('Not native execution');
  });
  it('reads hash-frozen split json-chunks and deduplicates replayed identical requests without losing their sources', () => {
    const text = JSON.stringify({ encoding: 'json-chunks', chunks: [JSON.stringify(envelope())] });
    read.mockReturnValueOnce({ uri, hash, mimeType: 'application/json', bytes: text.length, text: text.slice(0, 50), truncated: true, next: { offset: 1, column: 50 } })
      .mockReturnValueOnce({ uri, hash, mimeType: 'application/json', bytes: text.length, text: text.slice(50), truncated: false });
    readEntries.mockReturnValue([entry(), { ...entry(), turnId: 'later-turn' }]);
    materializeRecordedRdcRequest(context, uri, hash, deps);
    expect(read.mock.calls[1][2]).toMatchObject({ expectedHash: hash, offset: 1, column: 50 });
    expect(JSON.parse(write.mock.calls[0][2]).sources).toHaveLength(2);
  });
  it.each(['missing', 'conflict', 'operation', 'sensitive', 'owner', 'non-native', 'invalid-json', 'stuck-page'])(
    'rejects %s without publishing a witness', mode => {
      if (mode === 'missing') readEntries.mockReturnValue([]);
      if (mode === 'conflict') readEntries.mockReturnValue([entry(), entry({ shader_debug_id: 'different' })]);
      if (mode === 'operation') { const e = entry(); const c = e.messages[0]; if (c.role === 'assistant' && c.content[0].type === 'toolCall') c.content[0].arguments = { rdc: { operation: 'rd.debug.finish', args: {} } }; readEntries.mockReturnValue([e]); }
      if (mode === 'sensitive') readEntries.mockReturnValue([entry({ nested: { api_key: 'never disclose' } })]);
      if (mode === 'owner') read.mockReturnValue({ uri, hash, mimeType: 'application/json', bytes: 100, text: JSON.stringify({ ...envelope(), owner: 'other' }) });
      if (mode === 'non-native') read.mockReturnValue({ uri, hash, mimeType: 'application/json', bytes: 100, text: JSON.stringify({ ...envelope(), details: { operation: 'shell.command' } }) });
      if (mode === 'invalid-json') read.mockReturnValue({ uri, hash, mimeType: 'application/json', bytes: 1, text: '{' });
      if (mode === 'stuck-page') read.mockReturnValue({ uri, hash, mimeType: 'application/json', bytes: 1, text: '', next: { offset: 1, column: 0 } });
      expect(() => materializeRecordedRdcRequest(context, uri, hash, deps)).toThrow(/ARTIFACT_REQUEST_(UNAVAILABLE|CONFLICT)/);
      expect(write).not.toHaveBeenCalled();
    },
  );
  it('propagates hash mismatch and rejects unbound lookup before journal access', () => {
    expect(() => materializeRecordedRdcRequest(context, uri, undefined, deps)).toThrow('ARTIFACT_HASH_REQUIRED');
    read.mockImplementation(() => { throw new Error('ARTIFACT_HASH_MISMATCH'); });
    expect(() => materializeRecordedRdcRequest(context, uri, hash, deps)).toThrow('ARTIFACT_HASH_MISMATCH');
    expect(readEntries).not.toHaveBeenCalled();
  });
  it('denies Mission and all children including a General child with an exact output grant', () => {
    expect(() => materializeRecordedRdcRequest({ ...context, agentId: 'debugger' }, uri, hash, deps)).toThrow('ARTIFACT_SESSION_DENIED');
    const release = grantDelegatedArtifactAccess('child', 'parent', [uri], { read });
    try { expect(() => materializeRecordedRdcRequest({ ...context, sessionId: 'child' }, uri, hash, deps)).toThrow('ARTIFACT_SESSION_DENIED'); }
    finally { release(); }
    expect(readEntries).not.toHaveBeenCalled();
  });
});

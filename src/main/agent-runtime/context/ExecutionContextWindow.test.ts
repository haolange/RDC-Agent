import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { beforeEach, expect, it, vi } from 'vitest';
import type { AgentMessage, AssistantMessage } from '../core/types';
const mocks = vi.hoisted(() => ({ hook: vi.fn(), save: vi.fn(), verify: vi.fn(), state: vi.fn(), generate: vi.fn(), write: vi.fn(), read: vi.fn(), list: vi.fn(), resolve: vi.fn(), journal: vi.fn(), archive: vi.fn(), project: vi.fn() }));
vi.mock('../../hooks/runtimeHookDispatch', () => ({ dispatchRuntimeHooks: mocks.hook }));
vi.mock('../../sessions/StorageAdapter', () => ({ storageAdapter: { readSession: () => ({ projectId: 'project' }), readSessionContextJournal: mocks.journal } }));
vi.mock('../../settings/projectRegistryLookup', () => ({ lookupProjectById: () => ({ rootPath: 'project-root' }) }));
vi.mock('../../sessions/CompactionAuthoritySource', () => ({ saveCompactionAuthoritySource: mocks.save, verifyCompactionAuthoritySource: mocks.verify, readCompactionAuthorityState: mocks.state, readCompactionAuthorityJournal: mocks.archive, projectCompactionJournalMessages: mocks.project }));
vi.mock('./CompactionHandoffService', () => ({ generateCompactionSections: mocks.generate }));
vi.mock('./StructuredHandoffBuilder', () => ({ serializeHandoffSourceTranscript: () => 'originals', assembleDerivedContextView: () => ({}), createStructuredHandoffMessage: () => ({ role: 'user', content: 'retained state', timestamp: 1 }) }));
vi.mock('../../sessions/DelegatedArtifactAccess', () => ({ delegatedArtifactOwner: () => 'owner', grantDelegatedOutput: vi.fn() }));
vi.mock('../../sessions/SessionArtifactResolver', () => ({ sessionArtifactResolver: { write: mocks.write, read: mocks.read, list: mocks.list, resolve: mocks.resolve } }));
import { hashScopedResource } from '../../runtime/ScopedResourceResolver';
import { createExecutionContextWindow } from './ExecutionContextWindow';
const messages: AgentMessage[] = Array.from({ length: 12 }, (_, i) => ({ role: 'user', content: `source ${i}: ` + 'x'.repeat(100), timestamp: i }));
const create = (providerId = 'provider', snapshotId = 'snapshot-a', routeRevision = 'route-a', catalogRevision = 'catalog-a', identityPatch: Record<string, unknown> = {}) => createExecutionContextWindow({
  sessionId: 'child', provider: { id: providerId } as never, model: { modelId: 'model' } as never,
  plan: { executionIdentity: { providerId, effectiveModelId: 'model', modelSnapshotId: snapshotId,
    routeRevision, catalogRevision, fingerprint: `${providerId}-${snapshotId}-${routeRevision}`, ...identityPatch } } as never,
  credentialHandle: 'opaque', tokenLimit: 650,
  estimate: values => values.reduce((n, value) => n + JSON.stringify(value.content).length, 0),
});
beforeEach(() => {
  vi.resetAllMocks(); mocks.hook.mockResolvedValue(true); mocks.state.mockResolvedValue('authority');
  mocks.save.mockResolvedValue({ uri: 'session://tool-outputs/source.json', hash: 'source-hash', context: '{}', stateHash: hashScopedResource('authority') });
  mocks.generate.mockResolvedValue({ criticalContext: [], usage: { inputTokens: 500, outputTokens: 30 } });
  mocks.write.mockReturnValue({ hash: 'window-hash' });
  mocks.list.mockReturnValue([]);
  mocks.journal.mockReturnValue([]);
  mocks.archive.mockReturnValue([]);
  mocks.project.mockImplementation((values: AgentMessage[]) => values);
});
it('collects route identities without retaining journal message payloads', async () => {
  mocks.journal.mockImplementation((_session, select) => {
    expect(typeof select).toBe('function');
    expect(select({ executionIdentity: { fingerprint: 'old-route' },
      get messages() { throw new Error('Route lookup must not access message payloads'); } })).toBe(false);
    return [];
  });
  await create().prepare([{ role: 'user', content: 'small input', timestamp: 1 }]);
  expect(mocks.journal).toHaveBeenCalledTimes(1);
});
it('starts an isolated delegated execution without reading a nonexistent child journal or parent window', async () => {
  mocks.journal.mockImplementation(() => { throw new Error('Session not found for context journal'); });
  mocks.list.mockReturnValue(['session://tool-outputs/parent-window-state.json']);
  const window = createExecutionContextWindow({
    sessionId: 'owner::subagent::execution-1', provider: { id: 'provider' } as never,
    model: { modelId: 'model' } as never, plan: { executionIdentity: {
      providerId: 'provider', effectiveModelId: 'model', modelSnapshotId: 'snapshot-a',
      routeRevision: 'route-a', fingerprint: 'provider-snapshot-a-route-a',
    } } as never,
    credentialHandle: 'opaque', tokenLimit: 650,
    estimate: values => values.reduce((n, value) => n + JSON.stringify(value.content).length, 0),
  });
  const result = await window.prepare([{ role: 'user', content: 'isolated input', timestamp: 1 }]);
  expect(result.messages).toEqual([{ role: 'user', content: 'isolated input', timestamp: 1 }]);
  expect(mocks.journal).not.toHaveBeenCalled();
  expect(mocks.list).not.toHaveBeenCalled();
});
it('keeps large retained vision bytes in verified sidecars and restores the exact image across executions', async () => {
  const actual = await vi.importActual<typeof import('../../sessions/CompactionAuthoritySource')>('../../sessions/CompactionAuthoritySource');
  mocks.project.mockImplementation(actual.projectCompactionJournalMessages);
  const data = Buffer.alloc(2_639_085, 7).toString('base64');
  const input = structuredClone(messages);
  input[10] = { role: 'user', content: [{ type: 'image', data, mimeType: 'image/png' }], timestamp: 10 };
  const make = () => createExecutionContextWindow({ sessionId: 'child', provider: { id: 'provider' } as never,
    model: { modelId: 'model' } as never, plan: {} as never, credentialHandle: 'opaque', tokenLimit: 650,
    estimate: values => values.reduce((count, message) => count + (Array.isArray(message.content) ? 100 : String(message.content).length), 0) });
  mocks.write.mockImplementation((_owner, _uri, content, options) => {
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
    if (options.mimeType === 'application/json' && bytes.length > 2 * 1024 * 1024) throw new Error('ARTIFACT_TOO_LARGE');
    return { uri: _uri, hash: crypto.createHash('sha256').update(bytes).digest('hex') };
  });
  mocks.read.mockReturnValue({ hash: 'source-hash' });
  const live = await make().prepare(input);
  expect(live.messages.some(message => Array.isArray(message.content) && message.content.some(block => block.type === 'image' && block.data === data))).toBe(true);
  const saved = mocks.write.mock.calls.find(call => String(call[1]).endsWith('-window-state.json'))!;
  const record = JSON.parse(String(saved[2]));
  expect(record.media).toHaveLength(1);
  expect(Buffer.byteLength(String(saved[2]))).toBeLessThan(2 * 1024 * 1024);
  const image = mocks.write.mock.calls.find(call => String(call[1]).endsWith('.png'))!;
  expect(Buffer.isBuffer(image[2]) && image[2].equals(Buffer.from(data, 'base64'))).toBe(true);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-retained-vision-'));
  try {
    const file = path.join(directory, 'window.json');
    fs.writeFileSync(file, String(saved[2]));
    mocks.list.mockReturnValue([saved[1]]);
    mocks.resolve.mockReturnValue({ absolutePath: file });
    mocks.read.mockImplementation((_owner, uri, options) => uri === record.media[0].uri
      ? { hash: record.media[0].hash, mimeType: 'image/png', imageData: options.includeImageData ? data : undefined }
      : { hash: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') });
    const restored = await make().prepare(input);
    expect(restored.messages).toEqual(live.messages);
    expect(mocks.read).toHaveBeenCalledWith('owner', record.media[0].uri, { expectedHash: record.media[0].hash, includeImageData: true });
    mocks.read.mockImplementation((_owner, uri) => { if (uri === record.media[0].uri) throw new Error('ARTIFACT_HASH_MISMATCH'); return { hash: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') }; });
    await expect(make().prepare(input)).rejects.toThrow('ARTIFACT_HASH_MISMATCH');
    mocks.read.mockImplementation((_owner, uri) => uri === record.media[0].uri
      ? { hash: record.media[0].hash, mimeType: 'application/json', imageData: data }
      : { hash: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') });
    await expect(make().prepare(input)).rejects.toThrow('retained media is not the declared image');
    record.media[0].blockIndex = 999;
    fs.writeFileSync(file, JSON.stringify(record));
    await expect(make().prepare(input)).rejects.toThrow('malformed retained media reference');
    expect(input[10]).toMatchObject({ content: [{ type: 'image', data }] });
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
it('blocks before source writes or model calls when a trusted hook denies compaction', async () => {
  mocks.hook.mockResolvedValue(false);
  await expect(create().prepare(messages)).rejects.toThrow('COMPACTION_HOOK_BLOCKED');
  expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.generate).not.toHaveBeenCalled();
  expect(mocks.hook).toHaveBeenCalledWith('context.before-compact', expect.objectContaining({ sessionId: 'child', projectRoot: 'project-root' }));
});
it('preserves execution ownership and publishes after persistence and source verification', async () => {
  await create().prepare(messages);
  expect(mocks.write).toHaveBeenCalledWith('owner', 'session://tool-outputs/source-window.json', expect.any(String), expect.any(Object));
  expect(mocks.verify.mock.invocationCallOrder[0]).toBeLessThan(mocks.write.mock.invocationCallOrder[0]);
  expect(mocks.hook).toHaveBeenLastCalledWith('context.after-compact', expect.objectContaining({ sessionId: 'child', payload: expect.objectContaining({ applied: true, sourceHash: 'source-hash' }) }));
});
it('discards the candidate if authoritative execution state changes during generation', async () => {
  mocks.state.mockResolvedValue('revised authority');
  await expect(create().prepare(messages)).rejects.toThrow('COMPACTION_SOURCE_CHANGED');
  expect(mocks.write).not.toHaveBeenCalled(); expect(mocks.hook).toHaveBeenCalledTimes(1);
});
it('restores portable data across model and effort switches only with verified source and authenticated route', async () => {
  const withThinking = structuredClone(messages);
  withThinking[10] = { role: 'assistant', content: [
    { type: 'thinking', text: 'ephemeral reasoning' },
    { type: 'text', text: 'source 1' },
    { type: 'toolCall', id: 'call-1', name: 'read', arguments: { path: 'source' },
      providerOutputRef: { protocol: 'OpenAIResponses', providerBlockKey: 'tool:1', contentIndex: 2 } },
  ], model: 'model', provider: 'provider', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, timestamp: 1, stopReason: 'stop' };
  await create().prepare(withThinking);
  const saved = mocks.write.mock.calls.find((call) => String(call[1]).endsWith('-window-state.json'));
  expect(saved).toBeDefined();
  const uri = String(saved![1]);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-context-window-'));
  try {
    const file = path.join(directory, 'window.json');
    fs.writeFileSync(file, String(saved![2]), 'utf8');
    const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    mocks.list.mockReturnValue([uri]);
    mocks.resolve.mockReturnValue({ absolutePath: file });
    mocks.read.mockImplementation((_owner, requested) => ({ hash: requested === uri ? hash : 'source-hash' }));
    mocks.journal.mockImplementation((_session, select) => [{ executionIdentity: { providerId: 'provider', effectiveModelId: 'model', modelSnapshotId: 'snapshot-a',
      routeRevision: 'route-a', catalogRevision: 'catalog-a', fingerprint: 'provider-snapshot-a-route-a' } }].filter(select));
    mocks.generate.mockClear();
    const materialized = structuredClone(withThinking);
    const assistant = materialized[10] as AssistantMessage;
    assistant.content = assistant.content.filter(block => block.type !== 'thinking').map(block => {
      if (block.type !== 'toolCall') return block;
      const { providerOutputRef: _ref, ...portable } = block;
      return portable;
    });
    const next = await create('provider', 'snapshot-b').prepare([...materialized, { role: 'user', content: 'next task', timestamp: 20 }]);
    expect(next.summary).toBeUndefined();
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(next.messages.at(-1)?.content).toBe('next task');
    const refreshedCatalog = await create('provider', 'snapshot-b', 'route-a', 'catalog-b').prepare([...materialized, { role: 'user', content: 'next task', timestamp: 20 }]);
    expect(refreshedCatalog.summary).toBeUndefined();
    expect(mocks.generate).not.toHaveBeenCalled();
    const switched = await create('provider', 'snapshot-b', 'route-a', 'catalog-b', {
      selectedModelId: 'new-model', effectiveModelId: 'new-model', canonicalModelId: 'new-model',
      reasoningMode: 'low', variantKey: 'new-model-low',
    }).prepare([...materialized, { role: 'user', content: 'continue with selected model', timestamp: 21 }]);
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(switched.messages.at(-1)?.content).toBe('continue with selected model');
    expect(JSON.stringify(switched.messages)).not.toContain('ephemeral reasoning');
    expect(JSON.stringify(switched.messages)).not.toContain('providerOutputRef');
    const changed = structuredClone(materialized);
    changed[0] = { role: 'user', content: 'revised original', timestamp: 0 };
    await create().prepare(changed);
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    await create('another-provider').prepare(materialized);
    expect(mocks.generate).toHaveBeenCalledTimes(2);
    await create('provider', 'snapshot-b', 'route-b').prepare(materialized);
    expect(mocks.generate).toHaveBeenCalledTimes(3);
    for (const field of ['credentialScopeHash', 'endpointHash', 'protocolFamily', 'contractHash', 'bindingIds']) {
      await create('provider', 'snapshot-b', 'route-a', 'catalog-b', {
        [field]: field === 'bindingIds' ? ['changed-binding'] : 'changed',
      }).prepare(materialized);
    }
    expect(mocks.generate).toHaveBeenCalledTimes(8);
    mocks.journal.mockReturnValue([]);
    await create('provider', 'snapshot-b').prepare(materialized);
    expect(mocks.generate).toHaveBeenCalledTimes(9);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

it('recovers a prior portable-hash mismatch only by matching the archived prefix and retained tail', async () => {
  const old = structuredClone(messages);
  old[2] = { role: 'assistant', content: [{ type: 'toolCall', id: 'call-2', name: 'read', arguments: { key: 'evidence' },
    providerOutputRef: { protocol: 'OpenAIResponses', providerBlockKey: 'tool:2', contentIndex: 0 } }],
    model: 'model', provider: 'provider', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, timestamp: 2, stopReason: 'stop' };
  const current = structuredClone(old);
  const call = (current[2] as AssistantMessage).content[0];
  if (call.type !== 'toolCall') throw new Error('test setup');
  delete call.providerOutputRef;
  const project = (values: AgentMessage[]) => values.map(value => {
    if (value.role !== 'assistant') return value;
    const assistant = value as AssistantMessage;
    return { ...assistant, content: assistant.content.map(block => {
      if (block.type !== 'toolCall') return block;
      const { providerOutputRef: _ref, ...portable } = block;
      return portable;
    }) };
  });
  mocks.project.mockImplementation(project);
  mocks.archive.mockReturnValue(project(old.slice(0, 8)));
  const record = { schemaVersion: 1, sessionId: 'child', routeFingerprint: 'provider-snapshot-a-route-a',
    source: 'session://tool-outputs/source.json', sourceHash: 'source-hash', count: old.length,
    hash: hashScopedResource(old), portableHash: hashScopedResource(old),
    window: [{ role: 'user', content: 'retained state', timestamp: 1 }, ...old.slice(8)] };
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-context-archive-'));
  try {
    const file = path.join(directory, 'window.json');
    fs.writeFileSync(file, JSON.stringify(record), 'utf8');
    const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    mocks.list.mockReturnValue(['session://tool-outputs/old-window-state.json']);
    mocks.resolve.mockReturnValue({ absolutePath: file });
    mocks.read.mockReturnValue({ hash });
    mocks.journal.mockImplementation((_session, select) => [{ executionIdentity: { providerId: 'provider', effectiveModelId: 'model', modelSnapshotId: 'snapshot-a',
      routeRevision: 'route-a', catalogRevision: 'catalog-a', fingerprint: 'provider-snapshot-a-route-a' } }].filter(select));
    const nextInput = [...current, { role: 'user' as const, content: 'continue', timestamp: 20 }];
    const restored = await create().prepare(nextInput);
    expect(restored.summary).toBeUndefined();
    expect(mocks.archive).toHaveBeenCalledWith('child', record.source, record.sourceHash);
    expect(mocks.generate).not.toHaveBeenCalled();
    mocks.archive.mockReturnValue([{ role: 'user', content: 'different original', timestamp: 0 }, ...project(old.slice(1, 8))]);
    await create().prepare(nextInput);
    expect(mocks.generate).toHaveBeenCalledTimes(1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

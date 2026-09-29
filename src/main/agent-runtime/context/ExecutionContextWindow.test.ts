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
const create = (providerId = 'provider', snapshotId = 'snapshot-a', routeRevision = 'route-a', catalogRevision = 'catalog-a') => createExecutionContextWindow({
  sessionId: 'child', provider: { id: providerId } as never, model: { modelId: 'model' } as never,
  plan: { executionIdentity: { providerId, effectiveModelId: 'model', modelSnapshotId: snapshotId,
    routeRevision, catalogRevision, fingerprint: `${providerId}-${snapshotId}-${routeRevision}` } } as never,
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
it('restores the verified window across execution instances only for the same source and route', async () => {
  const withThinking = structuredClone(messages);
  withThinking[1] = { role: 'assistant', content: [
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
    mocks.journal.mockReturnValue([{ executionIdentity: { providerId: 'provider', effectiveModelId: 'model', modelSnapshotId: 'snapshot-a',
      routeRevision: 'route-a', catalogRevision: 'catalog-a', fingerprint: 'provider-snapshot-a-route-a' } }]);
    mocks.generate.mockClear();
    const materialized = structuredClone(withThinking);
    const assistant = materialized[1] as AssistantMessage;
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
    const changed = structuredClone(materialized);
    changed[0] = { role: 'user', content: 'revised original', timestamp: 0 };
    await create().prepare(changed);
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    await create('another-provider').prepare(materialized);
    expect(mocks.generate).toHaveBeenCalledTimes(2);
    await create('provider', 'snapshot-b', 'route-b').prepare(materialized);
    expect(mocks.generate).toHaveBeenCalledTimes(3);
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
    mocks.journal.mockReturnValue([{ executionIdentity: { providerId: 'provider', effectiveModelId: 'model', modelSnapshotId: 'snapshot-a',
      routeRevision: 'route-a', catalogRevision: 'catalog-a', fingerprint: 'provider-snapshot-a-route-a' } }]);
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

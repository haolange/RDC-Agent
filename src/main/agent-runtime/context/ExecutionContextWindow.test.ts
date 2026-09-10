import { beforeEach, expect, it, vi } from 'vitest';
import type { AgentMessage } from '../core/types';
const mocks = vi.hoisted(() => ({ hook: vi.fn(), save: vi.fn(), verify: vi.fn(), state: vi.fn(), generate: vi.fn(), write: vi.fn(), read: vi.fn() }));
vi.mock('../../hooks/runtimeHookDispatch', () => ({ dispatchRuntimeHooks: mocks.hook }));
vi.mock('../../sessions/StorageAdapter', () => ({ storageAdapter: { readSession: () => ({ projectId: 'project' }) } }));
vi.mock('../../settings/projectRegistryLookup', () => ({ lookupProjectById: () => ({ rootPath: 'project-root' }) }));
vi.mock('../../sessions/CompactionAuthoritySource', () => ({ saveCompactionAuthoritySource: mocks.save, verifyCompactionAuthoritySource: mocks.verify, readCompactionAuthorityState: mocks.state }));
vi.mock('./CompactionHandoffService', () => ({ generateCompactionSections: mocks.generate }));
vi.mock('./StructuredHandoffBuilder', () => ({ serializeHandoffSourceTranscript: () => 'originals', assembleDerivedContextView: () => ({}), createStructuredHandoffMessage: () => ({ role: 'user', content: 'retained state', timestamp: 1 }) }));
vi.mock('../../sessions/DelegatedArtifactAccess', () => ({ delegatedArtifactOwner: () => 'owner', grantDelegatedOutput: vi.fn() }));
vi.mock('../../sessions/SessionArtifactResolver', () => ({ sessionArtifactResolver: { write: mocks.write, read: mocks.read } }));
import { hashScopedResource } from '../../runtime/ScopedResourceResolver';
import { createExecutionContextWindow } from './ExecutionContextWindow';
const messages: AgentMessage[] = Array.from({ length: 12 }, (_, i) => ({ role: 'user', content: `source ${i}: ` + 'x'.repeat(100), timestamp: i }));
const create = () => createExecutionContextWindow({ sessionId: 'child', provider: { id: 'provider' } as never, model: { modelId: 'model' } as never, plan: {} as never, credentialHandle: 'opaque', tokenLimit: 650, estimate: values => values.reduce((n, value) => n + JSON.stringify(value.content).length, 0) });
beforeEach(() => {
  vi.resetAllMocks(); mocks.hook.mockResolvedValue(true); mocks.state.mockResolvedValue('authority');
  mocks.save.mockResolvedValue({ uri: 'session://tool-outputs/source.json', hash: 'source-hash', context: '{}', stateHash: hashScopedResource('authority') });
  mocks.generate.mockResolvedValue({ criticalContext: [], usage: { inputTokens: 500, outputTokens: 30 } });
  mocks.write.mockReturnValue({ hash: 'window-hash' });
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

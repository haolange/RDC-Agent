import { beforeEach, expect, it, vi } from 'vitest';
import type { AssistantMessage } from '../core/types';
import type { CompactionHandoffExecution } from './CompactionHandoffRuntime';
const mock = vi.hoisted(() => ({ stream: vi.fn(), write: vi.fn(), complete: vi.fn() }));
vi.mock('../providers/ConfiguredRuntimeProvider', () => ({ configuredRuntimeProvider: { stream: mock.stream }, encodeAgentModel: () => 'frozen-route' }));
vi.mock('../prompt', () => ({ requestEnvelopeBuilder: { build: (value: unknown) => ({ id: 'snapshot', value }) }, requestSnapshotStore: { nextCallIndex: () => 1, write: mock.write, complete: mock.complete } }));
vi.mock('../prompt/PromptCacheCompiler', () => ({ promptCacheCompiler: { compile: () => ({ enabled: true }) } }));
vi.mock('../capabilities/RouteCapabilityResolver', () => ({ resolveAgentRouteCapability: () => ({ reasoningContract: {} }) }));
import { executeCompactionHandoff } from './CompactionHandoffRuntime';
const input = { sessionId: 'session', provider: { id: 'account' }, model: { modelId: 'model' }, plan: { providerId: 'account', effectiveModelId: 'model', contextWindowTokens: 32768, route: { protocol: 'OpenAIResponses' }, reasoningWire: { selection: 'low' } }, credentialHandle: 'opaque', transcript: 'Original user correction: preserve highlights; hypothesis unverified.' } as CompactionHandoffExecution;
const message = (stopReason: AssistantMessage['stopReason']): AssistantMessage => ({ role: 'assistant', content: [{ type: 'text', text: 'Partial generated state' }], stopReason, model: 'model', provider: 'account', timestamp: 0, usage: { inputTokens: 100, outputTokens: 40, totalTokens: 140 } });
beforeEach(() => { vi.clearAllMocks(); });
function providerResult(result: AssistantMessage) {
  mock.stream.mockReturnValue({ async *[Symbol.asyncIterator]() { yield { type: 'done' }; }, result: async () => result });
}
it.each(['length', 'toolUse', 'error', 'aborted'] as const)('does not accept incomplete provider termination %s as a usable compacted window', async stop => {
  providerResult(message(stop));
  await expect(executeCompactionHandoff(input)).rejects.toThrow('COMPACTION_INCOMPLETE');
  expect(mock.complete).toHaveBeenCalledWith('snapshot', 'session', expect.any(String), expect.objectContaining({ inputTokens: 100, outputTokens: 40 }));
});
it('uses no tools, preserves the frozen cancellation and route, and records measured usage', async () => {
  const result = message('stop'); providerResult(result); const signal = new AbortController().signal;
  await expect(executeCompactionHandoff({ ...input, signal })).resolves.toEqual(result);
  expect(mock.stream).toHaveBeenCalledWith('frozen-route', expect.objectContaining({ tools: [] }), expect.objectContaining({ requestPlan: input.plan, credentialHandle: 'opaque', signal, maxTokens: 4096, promptCache: expect.objectContaining({ enabled: false }) }));
  expect(mock.write).toHaveBeenCalledOnce();
});
it('rejects cancellation after the provider returned, without publishing a result', async () => {
  const abort = new AbortController();
  mock.stream.mockReturnValue({ async *[Symbol.asyncIterator]() { abort.abort(); yield { type: 'done' }; }, result: async () => message('stop') });
  await expect(executeCompactionHandoff({ ...input, signal: abort.signal })).rejects.toMatchObject({ name: 'AbortError' });
  expect(mock.complete).not.toHaveBeenCalled();
});

import { beforeEach, expect, it, vi } from 'vitest';
import { executePermissionReview, parsePermissionReview } from './PermissionReviewRuntime';
import type { AssistantMessage } from '../core/types';

const mock = vi.hoisted(() => ({
  stream: vi.fn(),
  write: vi.fn(),
  complete: vi.fn(),
  compile: vi.fn(() => ({ enabled: true })),
}));
vi.mock('../providers/ConfiguredRuntimeProvider', () => ({
  configuredRuntimeProvider: { stream: mock.stream },
  encodeAgentModel: () => 'frozen-route',
}));
vi.mock('../prompt/RequestEnvelopeBuilder', () => ({
  requestEnvelopeBuilder: { build: (value: unknown) => ({ id: 'snapshot', value }) },
}));
vi.mock('../prompt/RequestSnapshotStore', () => ({
  requestSnapshotStore: { nextCallIndex: () => 1, write: mock.write, complete: mock.complete },
}));
vi.mock('../prompt/PromptCacheCompiler', () => ({
  promptCacheCompiler: { compile: mock.compile },
}));
const input: Parameters<typeof executePermissionReview>[0] = {
  sessionId: 'owner',
  plan: {
    providerId: 'account',
    effectiveModelId: 'model',
    contextBudgetTokens: 32768,
    contextWindowTokens: 32768,
    route: { protocol: 'OpenAIResponses' },
    reasoningWire: { selection: 'low' },
  } as never,
  credentialHandle: 'opaque-secret-handle',
  reasoning: {} as never,
  authority: 'User requested a bounded test edit and restoration.',
  action: { tool: 'edit_file', arguments: { path: 'test.txt' }, reason: 'review' },
};
function providerResult(text: string, stopReason: AssistantMessage['stopReason'] = 'stop') {
  const message = {
    role: 'assistant',
    content: [{ type: 'text', text }],
    stopReason,
    usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
  } as AssistantMessage;
  mock.stream.mockReturnValue({
    async *[Symbol.asyncIterator]() {
      yield { type: 'done' };
    },
    result: async () => message,
  });
}
beforeEach(() => vi.clearAllMocks());
it.each([
  '{"approved":true,"reason":"x"}',
  '{"verdict":"allow","reason":"x"}',
  '{"verdict":"allow","failedChecks":[],"reason":"x","tools":[]}',
  '{"verdict":"allow","failedChecks":[],"reason":"ok","reviewMethod":"rule"}',
  '{"verdict":"deny","failedChecks":["authorized"],"reason":"no","errorCode":"forged"}',
  '{"verdict":"maybe","failedChecks":["authorized"],"reason":"x"}',
  '{"verdict":"deny","failedChecks":[],"reason":"no check named"}',
  '{"verdict":"undecidable","failedChecks":[],"reason":"no check named"}',
  '{"verdict":"allow","failedChecks":["authorized"],"reason":"allow names a failure"}',
  '{"verdict":"deny","failedChecks":["looks-risky"],"reason":"unknown check"}',
  '{"verdict":"deny","failedChecks":["authorized","authorized"],"reason":"repeated"}',
  '```json\n{}\n```',
  '{"verdict":"allow","failedChecks":[],"reason":"   "}',
])('rejects malformed or permissive verdict %s', (text) => {
  expect(() => parsePermissionReview(text)).toThrow('PERMISSION_REVIEW_INVALID');
});
it.each([
  { verdict: 'allow', failedChecks: [] },
  { verdict: 'deny', failedChecks: ['target-matches', 'source-bound'] },
  { verdict: 'undecidable', failedChecks: ['baseline-recorded'] },
] as const)('accepts the closed $verdict verdict with its named checks', (value) => {
  expect(parsePermissionReview(JSON.stringify({ ...value, reason: ' Plain reason. ' }))).toEqual({
    ...value,
    reason: 'Plain reason.',
  });
});
it('uses the frozen review route with no tools, records usage, and excludes credentials from snapshots', async () => {
  providerResult('{"verdict":"allow","failedChecks":[],"reason":"Authorized bounded edit."}');
  await expect(executePermissionReview(input)).resolves.toEqual({
    verdict: 'allow',
    failedChecks: [],
    reason: 'Authorized bounded edit.',
  });
  expect(mock.stream).toHaveBeenCalledOnce();
  expect(mock.stream).toHaveBeenCalledWith(
    'frozen-route',
    expect.objectContaining({ tools: [] }),
    expect.objectContaining({
      requestPlan: input.plan,
      credentialHandle: input.credentialHandle,
      reasoning: { selection: 'low' },
      maxTokens: 1024,
      promptCache: expect.objectContaining({ enabled: true }),
    }),
  );
  expect(mock.compile).toHaveBeenCalledWith(expect.objectContaining({ affinityScopeId: 'owner#permission-review' }));
  expect(JSON.stringify(mock.write.mock.calls)).not.toContain(input.credentialHandle);
  expect(mock.complete).toHaveBeenCalledWith(
    'snapshot',
    'owner',
    expect.stringContaining('permission-review'),
    expect.objectContaining({ inputTokens: 100 }),
  );
});
it('retains a denied verdict and actual explanation', async () => {
  providerResult('{"verdict":"deny","failedChecks":["effects-bounded"],"reason":"Unrelated destructive operation."}');
  await expect(executePermissionReview(input)).resolves.toMatchObject({
    verdict: 'deny',
    failedChecks: ['effects-bounded'],
    reason: 'Unrelated destructive operation.',
  });
});
it.each(['length', 'toolUse', 'error', 'aborted'] as const)(
  'refuses incomplete termination %s without retry',
  async (stop) => {
    providerResult('{"verdict":"allow","failedChecks":[],"reason":"ok"}', stop);
    await expect(executePermissionReview(input)).rejects.toThrow('PERMISSION_REVIEW_INCOMPLETE');
    expect(mock.stream).toHaveBeenCalledOnce();
    expect(mock.complete).toHaveBeenCalledOnce();
  },
);
it('cancels an unresponsive provider without accepting a late verdict', async () => {
  const abort = new AbortController();
  mock.stream.mockReturnValue({
    async *[Symbol.asyncIterator]() {
      yield { type: 'start' };
      await new Promise(() => {});
    },
    result: async () => {
      throw new Error('unreachable');
    },
  });
  const pending = executePermissionReview({ ...input, signal: abort.signal });
  abort.abort();
  await expect(pending).rejects.toThrow('PERMISSION_REVIEW_CANCELLED');
  expect(mock.stream).toHaveBeenCalledOnce();
  expect(mock.complete).not.toHaveBeenCalled();
});
it('fails closed before provider dispatch when exact authority exceeds the fixed budget', async () => {
  await expect(executePermissionReview({ ...input, authority: 'a'.repeat(200000) })).rejects.toThrow('CONTEXT_LIMIT');
  expect(mock.stream).not.toHaveBeenCalled();
});
it('fits a full approved authority above the old 16k limit without dropping evidence or adding tools', async () => {
  providerResult('{"verdict":"deny","failedChecks":["authorized"],"reason":"Reviewed the complete authority."}');
  await executePermissionReview({
    ...input,
    authority: 'a'.repeat(72000),
    evidence: { originalObservation: 'retained' },
  });
  const snapshot = mock.write.mock.calls[0][0].value;
  expect(snapshot.promptPlan.totalTokenEstimate).toBeGreaterThan(16000);
  expect(snapshot.promptPlan.totalTokenEstimate).toBeLessThanOrEqual(32768 - 1024);
  expect(snapshot.messages[0].content).toContain('originalObservation');
  expect(snapshot.tools).toEqual([]);
  expect(mock.stream).toHaveBeenCalledOnce();
});
it('respects a tighter frozen route budget before dispatch', async () => {
  await expect(
    executePermissionReview({
      ...input,
      authority: 'a'.repeat(20000),
      plan: { ...input.plan, contextBudgetTokens: 4096, contextWindowTokens: 8192 },
    }),
  ).rejects.toThrow('CONTEXT_LIMIT');
  expect(mock.stream).not.toHaveBeenCalled();
});
it('does not dispatch without a durable request receipt', async () => {
  mock.write.mockImplementationOnce(() => {
    throw new Error('disk full');
  });
  await expect(executePermissionReview(input)).rejects.toThrow('disk full');
  expect(mock.stream).not.toHaveBeenCalled();
});
it('rejects credential-bearing actions before sending any automatic review request', async () => {
  await expect(
    executePermissionReview({ ...input, action: { ...input.action, arguments: { password: 'private-material' } } }),
  ).rejects.toThrow('SENSITIVE_INPUT');
  expect(mock.stream).not.toHaveBeenCalled();
  expect(mock.write).not.toHaveBeenCalled();
});

it('keeps the cached prefix byte-identical for two different actions under the same plan', async () => {
  providerResult('{"verdict":"allow","failedChecks":[],"reason":"Within the plan."}');
  await executePermissionReview({ ...input, action: { tool: 'edit_file', arguments: { path: 'a.txt' }, reason: 'a' } });
  await executePermissionReview({
    ...input,
    action: { tool: 'shell', arguments: { rdc: { operation: 'rd.shader.edit_and_replace' } }, reason: 'b' },
    evidence: { recent: ['different'] },
  });
  const [first, second] = mock.write.mock.calls.map(([snapshot]) => snapshot.value);
  expect(first.promptPlan.systemPrompt).toBe(second.promptPlan.systemPrompt);
  expect(first.promptPlan.stablePrefix).toEqual(second.promptPlan.stablePrefix);
  expect(first.promptPlan.systemPrompt).toContain(input.authority);
  expect(first.messages[0].content).not.toBe(second.messages[0].content);
  expect(first.messages[0].content).not.toContain(input.authority);
});

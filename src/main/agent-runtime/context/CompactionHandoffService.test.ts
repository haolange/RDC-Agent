import { beforeEach, expect, it, vi } from 'vitest';
const execute = vi.hoisted(() => vi.fn());
vi.mock('./CompactionHandoffRuntime', () => ({ executeCompactionHandoff: execute, assistantMessageText: () => '## Goal\nPreserve normal highlights\n## Critical Context\nIBL remains unverified.' }));
import { generateCompactionSections } from './CompactionHandoffService';
import type { CompactionHandoffExecution } from './CompactionHandoffRuntime';
const execution = { sessionId: 'session', provider: { id: 'frozen' }, model: { modelId: 'frozen-model' }, plan: { contextWindowTokens: 32768 }, credentialHandle: 'opaque', transcript: 'original' } as CompactionHandoffExecution;
beforeEach(() => { execute.mockReset(); execute.mockResolvedValue({ usage: { inputTokens: 123, outputTokens: 45 } }); });
it('uses the exact frozen route, credentials and signal and returns provider usage', async () => {
  const signal = new AbortController().signal;
  const result = await generateCompactionSections({ ...execution, signal });
  expect(execute).toHaveBeenCalledWith({ ...execution, signal });
  expect(result.usage).toEqual({ inputTokens: 123, outputTokens: 45 });
  expect(result.criticalContext).toContain('IBL remains unverified.');
});
it('rejects oversized original sources without trimming or making a provider call', async () => {
  await expect(generateCompactionSections({ ...execution, transcript: 'x'.repeat(500000) })).rejects.toThrow('COMPACTION_SOURCE_TOO_LARGE');
  expect(execute).not.toHaveBeenCalled();
});
it('does not invoke the provider after cancellation', async () => {
  const controller = new AbortController(); controller.abort();
  await expect(generateCompactionSections({ ...execution, signal: controller.signal })).rejects.toThrow();
  expect(execute).not.toHaveBeenCalled();
});

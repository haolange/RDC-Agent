import { beforeEach, describe, expect, it, vi } from 'vitest';
const io = vi.hoisted(() => ({ write: vi.fn(), read: vi.fn(), list: vi.fn(() => []) }));
vi.mock('./SessionArtifactResolver', () => ({ sessionArtifactResolver: io }));
vi.mock('../agent-runtime/tasks/sessionTaskStore', () => ({ createSessionTaskStore: () => ({ withLock: async (_key: string, action: () => Promise<unknown>) => action(), listTasks: async () => [], listExecutions: async () => [] }) }));
vi.mock('../investigation/InvestigationArtifactService', () => ({ investigationArtifactService: { list: () => [] } }));
import { saveCompactionAuthoritySource, verifyCompactionAuthoritySource } from './CompactionAuthoritySource';
import { serializeHandoffSourceTranscript } from '../agent-runtime/context/StructuredHandoffBuilder';
beforeEach(() => { vi.clearAllMocks(); io.write.mockReturnValue({ hash: 'a'.repeat(64) }); io.read.mockReturnValue({ hash: 'a'.repeat(64) }); });
describe('authoritative compaction checkpoint', () => {
  it('preserves critical long-message tails and writes bounded lines that can be paged', async () => {
    const text = 'x'.repeat(50000) + ' critical-tail: hypothesis only, recheck when capture changes';
    const messages = [{ role: 'user' as const, content: text, timestamp: 1 }];
    const saved = await saveCompactionAuthoritySource('session', messages);
    const content = io.write.mock.calls[0]![2] as string;
    expect(Math.max(...content.split('\n').map(line => line.length))).toBeLessThan(5000);
    const chunks = JSON.parse(content).chunks as string[];
    expect(JSON.parse(chunks.join('')).journalMessages[0].content).toBe(text);
    expect(serializeHandoffSourceTranscript(messages)).toContain('critical-tail');
    expect(() => verifyCompactionAuthoritySource('session', saved)).not.toThrow();
  });
  it('fails closed on failed save or failed hash verification', async () => {
    io.write.mockImplementationOnce(() => { throw new Error('disk full'); });
    await expect(saveCompactionAuthoritySource('session', [])).rejects.toThrow(/disk full/);
    io.read.mockImplementationOnce(() => { throw new Error('hash mismatch'); });
    await expect(saveCompactionAuthoritySource('session', [])).rejects.toThrow(/hash mismatch/);
  });
});

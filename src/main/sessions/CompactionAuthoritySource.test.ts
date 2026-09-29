import { beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const io = vi.hoisted(() => ({ write: vi.fn(), read: vi.fn(), resolve: vi.fn(), list: vi.fn((): string[] => []) }));
const authority = vi.hoisted(() => ({ tasks: [] as unknown[], executions: [] as unknown[], investigation: [] as Array<{ manifest: { artifactId: string }; record: unknown; contentUri: string; contentHash: string }> }));
vi.mock('./SessionArtifactResolver', () => ({ sessionArtifactResolver: io }));
vi.mock('../agent-runtime/tasks/sessionTaskStore', () => ({ createSessionTaskStore: () => ({ withLock: async (_key: string, action: () => Promise<unknown>) => action(), listTasks: async () => authority.tasks, listExecutions: async () => authority.executions }) }));
vi.mock('../investigation/InvestigationArtifactService', () => ({ investigationArtifactService: { readAllRecords: () => authority.investigation.map(item => ({ ...item, manifest: item.manifest })) } }));
import { projectCompactionJournalMessages, readCompactionAuthorityJournal, saveCompactionAuthoritySource, verifyCompactionAuthoritySource } from './CompactionAuthoritySource';
import { serializeHandoffSourceTranscript } from '../agent-runtime/context/StructuredHandoffBuilder';
beforeEach(() => { vi.clearAllMocks(); authority.tasks = []; authority.executions = []; authority.investigation = []; io.list.mockReturnValue([]); io.write.mockReturnValue({ hash: 'a'.repeat(64) }); io.read.mockReturnValue({ hash: 'a'.repeat(64) }); });
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
  it('keeps an oversized task failure in the archived source while bounding the model context', async () => {
    const failure = 'signed replay recovery failed; '.repeat(4_000);
    authority.tasks = [{ id: 'task-1', subject: 'Verify recovery', description: 'Keep the original failure', status: 'blocked', statusReason: failure,
      parentTaskId: undefined, blockedBy: [], executionIds: ['execution-1'], completionRequirements: ['signed restore'], }];
    authority.executions = [{ id: 'execution-1', taskId: 'task-1', generation: 1, mode: 'direct', status: 'blocked',
      result: { disposition: 'blocked', summary: 'Recovery not proven', resultRef: 'session://tool-outputs/failure.json', resultHash: 'b'.repeat(64) } }];
    io.list.mockReturnValue(['session://tool-outputs/failure.json']);
    const saved = await saveCompactionAuthoritySource('session', []);
    expect(saved.context.length).toBeLessThan(96_000);
    const context = JSON.parse(saved.context);
    expect(context.tasks[0]).toMatchObject({ id: 'task-1', status: 'blocked', statusReasonTruncated: true });
    expect(context.artifactRefs).toEqual([{ uri: 'session://tool-outputs/failure.json', hash: 'a'.repeat(64) }]);
    const manifest = JSON.parse(io.write.mock.calls.at(-1)![2] as string);
    const original = JSON.parse(manifest.chunks.join(''));
    expect(original.fullAuthorityState.tasks[0].statusReason).toBe(failure);
    expect(original.fullAuthorityState.executions[0].result.resultRef).toBe('session://tool-outputs/failure.json');
    expect(context.authorityArchive).toBe(saved.uri);
    expect(context.authorityStateHash).toBe(saved.stateHash);
  });
  it('indexes a long-running investigation without placing record bodies in the model input', async () => {
    authority.tasks = Array.from({ length: 24 }, (_, index) => ({
      id: `task-${index}`, subject: `Investigation step ${index}`, description: 'Current requirement '.repeat(20),
      status: index === 23 ? 'pending' : 'completed', executionIds: [`execution-${index}`],
      completionRequirements: ['verify source identity'],
    }));
    authority.executions = Array.from({ length: 25 }, (_, index) => ({
      id: `execution-${index}`, taskId: `task-${index % 24}`, generation: 1, mode: 'direct', status: 'completed',
      result: { disposition: 'completed', summary: 'Verified source', resultRef: `session://tool-outputs/result-${index}.json`, resultHash: 'b'.repeat(64) },
    }));
    io.list.mockReturnValue(Array.from({ length: 121 }, (_, index) => `session://tool-outputs/result-${index}.json`));
    authority.investigation = Array.from({ length: 19 }, (_, index) => ({
      manifest: { artifactId: `record-${index}`, kind: 'evidence', status: 'ready', title: `Source ${index}` },
      record: { body: `raw evidence ${index} `.repeat(1_000) },
      contentUri: `session://investigation/records/record-${index}.json`, contentHash: 'c'.repeat(64),
    }));
    const saved = await saveCompactionAuthoritySource('session', []);
    const context = JSON.parse(saved.context);
    expect(saved.context.length).toBeLessThan(96_000);
    expect(context.tasks).toHaveLength(24);
    expect(context.executions).toHaveLength(25);
    expect(context.artifactRefs).toHaveLength(121);
    expect(context.investigation).toHaveLength(19);
    expect(saved.context).not.toContain('raw evidence');
    const archive = JSON.parse(io.write.mock.calls.at(-1)![2] as string);
    const original = JSON.parse(archive.chunks.join(''));
    expect(original.fullAuthorityState.investigation[18].record.body).toContain('raw evidence 18');
  });
  it('keeps a growing authority index recoverable when its compact listing exceeds the prompt cap', async () => {
    authority.tasks = Array.from({ length: 42 }, (_, index) => ({
      id: `task-${index}`, subject: `Investigation step ${index}`, status: index === 41 ? 'in_progress' : 'completed',
      description: 'Inspect the current source', completionRequirements: ['verify replay identity'],
      executionIds: [`execution-${index}`],
    }));
    authority.executions = Array.from({ length: 42 }, (_, index) => ({
      id: `execution-${index}`, taskId: `task-${index}`, generation: 1, mode: 'direct', status: 'completed',
      result: { disposition: 'completed', summary: 'Checked', resultRef: `session://tool-outputs/result-${index}.json`, resultHash: 'b'.repeat(64) },
    }));
    io.list.mockReturnValue(Array.from({ length: 420 }, (_, index) => `session://tool-outputs/result-${index}.json`));
    authority.investigation = Array.from({ length: 150 }, (_, index) => ({
      manifest: { artifactId: `record-${index}`, kind: 'evidence', status: 'draft', title: `Source ${index}`,
        sourceRefs: Array.from({ length: 5 }, (_, source) => ({ uri: `session://tool-outputs/source-${index}-${source}.json`, hash: 'c'.repeat(64) })) },
      record: { body: `original evidence ${index}` },
      contentUri: `session://investigation/records/record-${index}.json`, contentHash: 'd'.repeat(64),
    }));
    const saved = await saveCompactionAuthoritySource('session', []);
    const context = JSON.parse(saved.context);
    expect(saved.context.length).toBeLessThan(96_000);
    expect(context.authorityArchive).toBe(saved.uri);
    expect(context.indexCoverage.complete).toBe(false);
    expect(context.indexCoverage.artifactRefs.total).toBe(420);
    expect(context.indexCoverage.investigation.total).toBe(150);
    expect(context.tasks.some((task: { id: string }) => task.id === 'task-41')).toBe(true);
    const envelope = JSON.parse(io.write.mock.calls.at(-1)![2] as string);
    const original = JSON.parse(envelope.chunks.join(''));
    expect(original.fullAuthorityState.artifactRefs).toHaveLength(420);
    expect(original.fullAuthorityState.investigation).toHaveLength(150);
    expect(original.fullAuthorityState.investigation[149].record.body).toBe('original evidence 149');
  });
});

it('archives original images as native readable references and excludes private provider state', async () => {
  const messages = [{ role: 'user' as const, content: [{ type: 'image' as const, data: Buffer.from('original-image').toString('base64'), mimeType: 'image/png' }], timestamp: 1 },
    { role: 'assistant' as const, content: [{ type: 'thinking' as const, thinking: 'private reasoning' }, { type: 'text' as const, text: 'Hypothesis only' }], providerState: { opaque: 'do-not-expose' }, timestamp: 2 }] as never;
  const saved = await saveCompactionAuthoritySource('session', messages);
  expect(io.write.mock.calls[0][2]).toEqual(Buffer.from('original-image'));
  expect(saved.context).toContain('media-');
  const manifest = JSON.parse(io.write.mock.calls.at(-1)![2] as string);
  const recovered = manifest.chunks.join('');
  expect(recovered).toContain('Original image: session://');
  expect(recovered).toContain('Hypothesis only');
  expect(recovered).not.toContain('private reasoning'); expect(recovered).not.toContain('do-not-expose');
});

it('recovers a split source only after checking each current part hash', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-compaction-source-'));
  const paths = new Map<string, string>();
  try {
    io.write.mockImplementation((_owner, uri: string, content: string | Buffer) => {
      const target = path.join(directory, uri.split('/').at(-1)!);
      fs.writeFileSync(target, content);
      paths.set(uri, target);
      return { hash: crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex') };
    });
    io.resolve.mockImplementation((_owner, uri: string) => ({ absolutePath: paths.get(uri) }));
    io.read.mockImplementation((_owner, uri: string, options?: { expectedHash?: string }) => {
      const target = paths.get(uri);
      if (!target) throw new Error('missing source');
      const hash = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
      if (options?.expectedHash && options.expectedHash !== hash) throw new Error('hash mismatch');
      return { hash };
    });
    const messages = Array.from({ length: 1500 }, (_, index) => ({ role: 'user' as const,
      content: `${index}: ${'x'.repeat(800)}`, timestamp: index }));
    const saved = await saveCompactionAuthoritySource('session', messages);
    expect(saved.parts.length).toBeGreaterThan(1);
    expect(readCompactionAuthorityJournal('session', saved.uri, saved.hash)).toEqual(projectCompactionJournalMessages(messages));
    io.list.mockReturnValue([saved.uri]);
    const nextMessages = [...messages, { role: 'user' as const, content: 'Only the new tail belongs in this source', timestamp: 1501 }];
    const next = await saveCompactionAuthoritySource('session', nextMessages);
    expect(next.journalPrefix).toEqual({ uri: saved.uri, hash: saved.hash, count: messages.length });
    expect(next.parts).toEqual([]);
    const nextEnvelope = JSON.parse(fs.readFileSync(paths.get(next.uri)!, 'utf8')) as { chunks: string[] };
    const nextSource = JSON.parse(nextEnvelope.chunks.join('')) as { journalPrefix: { count: number }; journalMessages: unknown[] };
    expect(nextSource.journalPrefix.count).toBe(messages.length);
    expect(nextSource.journalMessages).toHaveLength(1);
    expect(readCompactionAuthorityJournal('session', next.uri, next.hash)).toEqual(projectCompactionJournalMessages(nextMessages));
    expect(() => verifyCompactionAuthoritySource('session', next)).not.toThrow();
    const tamperedPart = paths.get(saved.parts[0].uri)!;
    fs.appendFileSync(tamperedPart, 'changed');
    expect(() => readCompactionAuthorityJournal('session', saved.uri, saved.hash)).toThrow('hash mismatch');
    expect(() => readCompactionAuthorityJournal('session', next.uri, next.hash)).toThrow('hash mismatch');
    expect(() => verifyCompactionAuthoritySource('session', next)).toThrow('hash mismatch');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

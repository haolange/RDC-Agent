import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { KnowledgeCardRecord } from '@shared/types/knowledge';
import { acquireDirectoryFileLock, releaseDirectoryFileLock } from '../sessions/directoryFileLock';
import { parseKnowledgeFrontmatter, sourceStatusImpliesVerified } from './knowledgeCardSchema';
import { KNOWLEDGE_IMPORT_MAX_BYTES, ingestKnowledgeFromPath, sanitizeProvenanceToken } from './knowledgeIngest';
import {
  KnowledgeApprovalTokenInvalidError,
  KnowledgeHumanConfirmationRequiredError,
  KnowledgeLifecycleError,
  KnowledgeRevisionConflictError,
  KnowledgeWritePathError,
} from './knowledgeErrors';
import {
  createSessionScopedKnowledgeStore,
  KnowledgeDurableStore,
} from './KnowledgeDurableStore';
import { createDisposableCandidateService } from './KnowledgeCandidateService';
import { KnowledgeIndexService } from './KnowledgeIndexService';
import { KnowledgeWriteService } from './KnowledgeWriteService';
import { KNOWLEDGE_STATE_LOCK_FILE, KNOWLEDGE_STATE_LOCK_TIMEOUT } from './knowledgeStateSchema';
import { serializeKnowledgeCard } from './knowledgeCardSchema';
import { StorageIo } from '../sessions/StorageIo';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function tempRoot(prefix: string): string {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}

function factCard(id = 'user:facts/sample.md'): KnowledgeCardRecord {
  return {
    cardId: id,
    spaceId: 'user',
    relativePath: id.slice(id.indexOf(':') + 1),
    type: 'fact',
    lifecycle: 'draft',
    title: `Fact ${id}`,
    scope: {},
    relations: [],
    body: `Body for ${id}`,
  };
}

function sha256File(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function sourceFingerprint(filePath: string): { hash: string; mtimeMs: number; size: number } {
  const stat = statSync(filePath);
  return { hash: sha256File(filePath), mtimeMs: Math.trunc(stat.mtimeMs), size: stat.size };
}

describe('Knowledge durable store', () => {
  it('survives a new service instance after Draft, Candidate, and review writes', async () => {
    const root = tempRoot('rdc-know-restart-');
    const first = createDisposableCandidateService(root, {
      now: () => new Date('2026-09-01T00:00:00.000Z'),
      createId: () => 'stable',
    });
    await first.ingestToStaging([
      'case_id: restart-case',
      'title: Restart case',
      'meta:',
      '  status: fixed',
      'symptoms: darker hair',
    ].join('\n'), { sessionId: 'sess-a' });
    await first.createCandidate({
      sessionId: 'sess-a',
      card: factCard(),
      explicitUserIntent: true,
    });
    await first.queueReview({ sessionId: 'sess-a', kind: 'write', cardId: 'user:facts/sample.md' });

    const restarted = createDisposableCandidateService(root);
    expect(await restarted.listStagedDrafts('sess-a')).toHaveLength(1);
    expect(await restarted.listCandidates('sess-a')).toHaveLength(1);
    expect(await restarted.listReviews('sess-a')).toHaveLength(1);
    expect((await restarted.listStagedDrafts('sess-a'))[0]?.lifecycle).toBe('draft');
    expect((await restarted.listCandidates('sess-a'))[0]?.card.lifecycle).toBe('candidate');
  });

  it('does not steal a live-pid knowledge-state lock', async () => {
    const root = tempRoot('rdc-know-live-lock-');
    const sessionDir = path.join(root, 'sess-lock');
    mkdirSync(sessionDir, { recursive: true });
    const held = await acquireDirectoryFileLock(sessionDir, {
      lockFileName: KNOWLEDGE_STATE_LOCK_FILE,
      timeoutCode: KNOWLEDGE_STATE_LOCK_TIMEOUT,
    });
    writeFileSync(held.lockPath, JSON.stringify({
      pid: process.pid,
      createdAt: Date.now() - 120_000,
    }), 'utf8');
    const store = new KnowledgeDurableStore({
      resolveStatePath: (sessionId) => path.join(root, sessionId, 'knowledge-state.json'),
      lockMaxAttempts: 3,
    });
    await expect(store.putDraft('sess-lock', { card: factCard() })).rejects.toThrow(/KNOWLEDGE_STATE_LOCK_TIMEOUT/);
    await releaseDirectoryFileLock(held.lockPath);
  });

  it('refuses a stale revision instead of overwriting', async () => {
    const store = createSessionScopedKnowledgeStore(tempRoot('rdc-know-rev-'));
    const created = await store.putDraft('sess-b', { card: factCard() });
    expect(created.revision).toBe(1);
    await expect(store.putDraft('sess-b', {
      card: { ...factCard(), body: 'changed' },
    })).rejects.toBeInstanceOf(KnowledgeRevisionConflictError);
    await expect(store.putDraft('sess-b', {
      card: { ...factCard(), body: 'changed' },
      expectedRevision: 0,
    })).rejects.toBeInstanceOf(KnowledgeRevisionConflictError);
    const updated = await store.putDraft('sess-b', {
      card: { ...factCard(), body: 'changed' },
      expectedRevision: 1,
    });
    expect(updated.revision).toBe(2);
    const listed = await store.listDrafts('sess-b');
    expect(listed).toHaveLength(1);
    expect(listed[0]?.card.body).toBe('changed');
  });

  it('keeps two independently accommodatable concurrent writes', async () => {
    const root = tempRoot('rdc-know-conc-');
    const store = createSessionScopedKnowledgeStore(root);
    const [left, right] = await Promise.all([
      store.putDraft('sess-c', { card: factCard('user:facts/one.md') }),
      store.putDraft('sess-c', { card: factCard('user:facts/two.md') }),
    ]);
    expect(left.card.cardId).toBe('user:facts/one.md');
    expect(right.card.cardId).toBe('user:facts/two.md');
    const listed = await new KnowledgeDurableStore({
      resolveStatePath: (sessionId) => path.join(root, sessionId, 'knowledge-state.json'),
    }).listDrafts('sess-c');
    expect(listed.map((entry) => entry.card.cardId).sort()).toEqual([
      'user:facts/one.md',
      'user:facts/two.md',
    ]);
  });

  it('serializes two node processes writing the same session store', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdc-know-xproc-'));
    roots.push(root);
    const workerPath = path.join(root, 'worker.cjs');
    const registerPath = path.resolve(__dirname, '../../../scripts/register-ts-source.cjs');
    const storePath = path.resolve(__dirname, './KnowledgeDurableStore.ts');
    await writeFile(workerPath, `
require(${JSON.stringify(registerPath)});
const { KnowledgeDurableStore } = require(${JSON.stringify(storePath)});
const root = process.env.KNOW_ROOT;
const sessionId = process.env.KNOW_SESSION;
const card = JSON.parse(process.env.KNOW_CARD);
(async () => {
  const store = new KnowledgeDurableStore({
    resolveStatePath: (id) => require('node:path').join(root, id, 'knowledge-state.json'),
  });
  const saved = await store.putDraft(sessionId, { card });
  process.stdout.write(JSON.stringify({ cardId: saved.card.cardId, revision: saved.revision }));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
`, 'utf8');
    const spawnWorker = (card: KnowledgeCardRecord) => new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [workerPath], {
        env: {
          ...process.env,
          KNOW_ROOT: root,
          KNOW_SESSION: 'sess-x',
          KNOW_CARD: JSON.stringify(card),
        },
        windowsHide: true,
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += String(chunk); });
      child.stderr.on('data', (chunk) => { stderr += String(chunk); });
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, stdout, stderr }));
    });
    const [first, second] = await Promise.all([
      spawnWorker(factCard('user:facts/proc-a.md')),
      spawnWorker(factCard('user:facts/proc-b.md')),
    ]);
    expect(first.code, first.stderr).toBe(0);
    expect(second.code, second.stderr).toBe(0);
    const store = createSessionScopedKnowledgeStore(root);
    const listed = (await store.listDrafts('sess-x')).map((entry) => entry.card.cardId).sort();
    expect(listed).toEqual(['user:facts/proc-a.md', 'user:facts/proc-b.md']);
  }, 20_000);

  it('fail-closes an unknown higher knowledge-state schemaVersion', async () => {
    const root = tempRoot('rdc-know-schema-');
    const sessionDir = path.join(root, 'sess-schema');
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(path.join(sessionDir, 'knowledge-state.json'), JSON.stringify({
      schemaVersion: '99',
      drafts: [],
      candidates: [],
      reviews: [],
    }), 'utf8');
    const store = createSessionScopedKnowledgeStore(root);
    await expect(store.listDrafts('sess-schema')).rejects.toThrow(/STORAGE_SCHEMA_UNSUPPORTED/);
  });

  it('fail-closes an unknown higher knowledge-index schemaVersion', async () => {
    const root = tempRoot('rdc-know-index-schema-');
    const snapshotPath = path.join(root, 'knowledge-index.json');
    writeFileSync(snapshotPath, JSON.stringify({
      schemaVersion: 99,
      revision: 'deadbeef',
      builtAt: '2026-09-01T00:00:00.000Z',
      cards: [],
    }), 'utf8');
    const index = new KnowledgeIndexService({
      listSpaces: () => [{ spaceId: 'user', kind: 'user', label: 'User', rootPath: root }],
      snapshotPath: () => snapshotPath,
      storage: new StorageIo(),
      now: () => new Date('2026-09-01T00:00:00.000Z'),
      readFile: (filePath) => readFile(filePath, 'utf8'),
      statMtime: async () => 0,
    });
    expect(() => index.getSnapshot()).toThrow(/STORAGE_SCHEMA_UNSUPPORTED/);
    await expect(index.getOrRebuild()).rejects.toThrow(/STORAGE_SCHEMA_UNSUPPORTED/);
  });
});

describe('knowledge path ingest', () => {
  it('records source hash/mtime/size and quarantines a mid-read change', async () => {
    const root = tempRoot('rdc-know-path-');
    const filePath = path.join(root, 'case.yaml');
    const yaml = [
      'case_id: path-case',
      'title: Path case',
      'meta:',
      '  status: fixed',
      'symptoms: darker',
    ].join('\n');
    writeFileSync(filePath, yaml, 'utf8');
    const before = sourceFingerprint(filePath);
    const candidates = createDisposableCandidateService(root);
    const result = await candidates.ingestPathToStaging(filePath, { sessionId: 'sess-path' });
    expect(result.items[0]?.status).toBe('draft');
    expect(result.candidateCreated).toBe(false);
    expect(result.sourceHash).toBe(before.hash);
    expect(result.sourceMtimeMs).toBe(before.mtimeMs);
    expect(result.sourceSize).toBe(before.size);
    expect(result.items[0]?.record?.sourceHash).toBe(before.hash);
    const drafts = await candidates.listStagedDrafts('sess-path');
    expect(drafts[0]?.sourceHash).toBe(before.hash);
    expect(drafts[0]?.sourceMtimeMs).toBe(before.mtimeMs);
    expect(drafts[0]?.sourceSize).toBe(before.size);

    const changed = Buffer.from(`${yaml}\nextra: 1\n`);
    let reads = 0;
    const quarantined = await ingestKnowledgeFromPath(filePath, {
      sessionId: 'sess-path',
      io: {
        stat: async () => {
          reads += 1;
          return reads === 1
            ? { mtimeMs: 1, size: yaml.length }
            : { mtimeMs: 2, size: changed.length };
        },
        readFile: async () => {
          return reads <= 1 ? Buffer.from(yaml) : changed;
        },
      },
    });
    expect(quarantined.items[0]?.status).toBe('quarantine');
    expect(quarantined.items[0]?.reason).toBe('source-changed');
    expect(quarantined.candidateCreated).toBe(false);
  });

  it('ingests synthetic Chinese-path import fixtures into disposable Drafts only', async () => {
    const root = tempRoot('rdc-know-fixtures-');
    const cases = [1, 2].map((index) => {
      const filePath = path.join(root, '案例' + index + '.txt');
      writeFileSync(filePath, [
        'case_id: synthetic-' + index,
        'title: Synthetic sanitization fixture',
        'meta:',
        '  status: fixed',
        'symptoms: 企业微信截图.png and HairBlack.txt are missing',
        'assets:',
        '  - file: 企业微信截图.png',
        '  - file: HairBlack.txt',
      ].join('\n'), 'utf8');
      return filePath;
    });
    const before = cases.map((filePath) => ({ filePath, ...sourceFingerprint(filePath) }));
    const candidates = createDisposableCandidateService(root);
    for (const [index, filePath] of cases.entries()) {
      const result = await candidates.ingestPathToStaging(filePath, {
        sessionId: `sess-real-${index + 1}`,
      });
      expect(result.items[0]?.status).toBe('draft');
      expect(result.candidateCreated).toBe(false);
      expect(result.verified).toBe(false);
      expect(result.items[0]?.lifecycle).toBe('draft');
      expect(result.items[0]?.record?.lifecycle).toBe('draft');
      expect(result.items[0]?.record?.sourceHash).toBe(before[index]?.hash);
      expect(await candidates.listCandidates(`sess-real-${index + 1}`)).toHaveLength(0);
      const drafts = await candidates.listStagedDrafts(`sess-real-${index + 1}`);
      expect(drafts).toHaveLength(1);
      const published = JSON.stringify({
        body: result.items[0]?.record?.body,
        chapters: result.items[0]?.record?.chapters,
        preview: result.items[0]?.record?.preview,
        missingAssets: result.items[0]?.missingAssets,
        draft: drafts[0],
      });
      expect(published).not.toContain('企业微信');
      expect(published).not.toContain('HairBlack');
      expect(published).not.toMatch(/\.txt/i);
      expect(result.items[0]?.missingAssets.some((id) => id.endsWith('.png'))).toBe(true);
      expect(result.items[0]?.missingAssets.some((id) => /^asset-[a-f0-9]{8}$/.test(id))).toBe(true);
    }
    for (const snapshot of before) {
      const after = sourceFingerprint(snapshot.filePath);
      expect(after.hash).toBe(snapshot.hash);
      expect(after.mtimeMs).toBe(snapshot.mtimeMs);
      expect(after.size).toBe(snapshot.size);
    }
  });

  it('quarantines absolute paths and secrets without creating a Draft', async () => {
    const root = tempRoot('rdc-know-q-');
    const candidates = createDisposableCandidateService(root);
    const leaks = ['C:/capture.rdc', 'C:\\capture.rdc', '/var/capture.rdc', '/Users/x/a.rdc'];
    for (const [index, leak] of leaks.entries()) {
      const sessionId = `sess-abs-${index}`;
      const result = await candidates.ingestToStaging([
        `case_id: abs-case-${index}`,
        'title: Abs',
        `symptoms: see ${leak}`,
      ].join('\n'), { sessionId });
      expect(result.items[0]?.status, leak).toBe('quarantine');
      expect(result.items[0]?.reason, leak).toBe('absolute-path');
      expect(result.items[0]?.record, leak).toBeUndefined();
      expect(await candidates.listStagedDrafts(sessionId)).toHaveLength(0);
    }
    const secret = await candidates.ingestToStaging([
      'case_id: secret-case',
      'title: Secret',
      'symptoms: api_key leaked',
    ].join('\n'), { sessionId: 'sess-q' });
    expect(secret.items[0]?.status).toBe('quarantine');
    expect(secret.items[0]?.reason).toBe('secret-detected');
    expect(await candidates.listStagedDrafts('sess-q')).toHaveLength(0);
    expect(await candidates.listCandidates('sess-q')).toHaveLength(0);
  });

  it('quarantines a file that grows past 2MB after the pre-stat', async () => {
    const oversized = Buffer.alloc(KNOWLEDGE_IMPORT_MAX_BYTES + 1, 0x61);
    const result = await ingestKnowledgeFromPath('grown.yaml', {
      io: {
        stat: async () => ({ mtimeMs: 1, size: 16 }),
        readFile: async () => oversized,
      },
    });
    expect(result.items[0]?.status).toBe('quarantine');
    expect(result.items[0]?.reason).toBe('source-too-large');
    expect(result.items[0]?.record).toBeUndefined();
  });
});

describe('Knowledge write gates', () => {
  function writeService(root: string, consume?: (token: string) => boolean): KnowledgeWriteService {
    return new KnowledgeWriteService({
      listSpaces: () => [{ spaceId: 'user', kind: 'user', label: 'User', rootPath: root }],
      now: () => new Date('2026-09-01T00:00:00.000Z'),
      ...(consume ? {
        consumeApprovalToken: (token) => consume(token),
      } : {}),
    });
  }

  it('rejects symlink, junction, hardlink, and .. write targets', async () => {
    const root = tempRoot('rdc-know-gate-');
    const write = writeService(root);
    await expect(write.write({
      spaceId: 'user',
      card: { ...factCard(), relativePath: '../escape.md' },
      permissionMode: 'full-access',
      confirmation: { explicitHumanConfirmation: true },
    })).rejects.toBeInstanceOf(KnowledgeWritePathError);

    const outside = path.join(root, 'outside');
    mkdirSync(outside, { recursive: true });
    const junction = path.join(root, 'facts');
    symlinkSync(outside, junction, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(write.write({
      spaceId: 'user',
      card: factCard('user:facts/via-junction.md'),
      permissionMode: 'full-access',
      confirmation: { explicitHumanConfirmation: true },
    })).rejects.toBeInstanceOf(KnowledgeWritePathError);

    const realFile = path.join(root, 'real.md');
    writeFileSync(realFile, 'seed', 'utf8');
    const hardlink = path.join(root, 'hard.md');
    linkSync(realFile, hardlink);
    expect(statSync(hardlink).nlink).toBeGreaterThan(1);
    await expect(write.write({
      spaceId: 'user',
      card: { ...factCard(), relativePath: 'hard.md' },
      permissionMode: 'full-access',
      confirmation: { explicitHumanConfirmation: true },
    })).rejects.toBeInstanceOf(KnowledgeWritePathError);
  });

  it('rejects a parent junction space root before mkdir', async () => {
    const root = tempRoot('rdc-know-parent-junc-');
    const outside = path.join(root, 'outside');
    mkdirSync(outside, { recursive: true });
    const before = readdirSync(outside);
    const junction = path.join(root, 'junction');
    symlinkSync(outside, junction, process.platform === 'win32' ? 'junction' : 'dir');
    const write = writeService(path.join(junction, 'knowledge'));
    await expect(write.write({
      spaceId: 'user',
      card: factCard(),
      permissionMode: 'full-access',
      confirmation: { explicitHumanConfirmation: true },
    })).rejects.toBeInstanceOf(KnowledgeWritePathError);
    expect(readdirSync(outside)).toEqual(before);
    expect(existsSync(path.join(outside, 'knowledge'))).toBe(false);
    expect(existsSync(path.join(outside, 'facts'))).toBe(false);
  });

  it('rejects missing confirmation and a reused approvalToken', async () => {
    const root = tempRoot('rdc-know-token-');
    const tokens = new Set(['tok-once']);
    const write = writeService(root, (token) => {
      if (!tokens.has(token)) return false;
      tokens.delete(token);
      return true;
    });
    await expect(write.write({
      spaceId: 'user',
      card: factCard(),
      permissionMode: 'full-access',
      confirmation: { explicitHumanConfirmation: false } as never,
      approvalToken: 'tok-once',
    })).rejects.toBeInstanceOf(KnowledgeHumanConfirmationRequiredError);
    const saved = await write.write({
      spaceId: 'user',
      card: factCard(),
      permissionMode: 'full-access',
      confirmation: { explicitHumanConfirmation: true },
      approvalToken: 'tok-once',
    });
    expect(saved.lifecycle).toBe('draft');
    await expect(write.write({
      spaceId: 'user',
      card: { ...factCard(), title: 'Again' },
      permissionMode: 'full-access',
      confirmation: { explicitHumanConfirmation: true },
      approvalToken: 'tok-once',
    })).rejects.toBeInstanceOf(KnowledgeApprovalTokenInvalidError);
  });

  it('consumes a promote approvalToken only once', async () => {
    const root = tempRoot('rdc-know-promote-tok-');
    const tokens = new Set(['tok-promote']);
    const write = writeService(root, (token) => {
      if (!tokens.has(token)) return false;
      tokens.delete(token);
      return true;
    });
    const saved = await write.promote({
      spaceId: 'user',
      card: { ...factCard(), lifecycle: 'candidate' },
      to: 'verified',
      permissionMode: 'full-access',
      confirmation: { explicitHumanConfirmation: true },
      approvalToken: 'tok-promote',
    });
    expect(saved.lifecycle).toBe('verified');
    await expect(write.promote({
      spaceId: 'user',
      card: { ...factCard(), lifecycle: 'candidate' },
      to: 'verified',
      permissionMode: 'full-access',
      confirmation: { explicitHumanConfirmation: true },
      approvalToken: 'tok-promote',
    })).rejects.toBeInstanceOf(KnowledgeApprovalTokenInvalidError);
  });

  it('never treats sourceStatus=fixed as verified', async () => {
    expect(sourceStatusImpliesVerified('fixed')).toBe(false);
    const root = tempRoot('rdc-know-fixed-');
    const write = writeService(root);
    const candidates = createDisposableCandidateService(root);
    const result = await candidates.ingestToStaging([
      'case_id: fixed-case',
      'title: Fixed case',
      'meta:',
      '  status: fixed',
      'symptoms: darker',
    ].join('\n'), { sessionId: 'sess-fixed' });
    expect(result.items[0]?.sourceStatus).toBe('fixed');
    expect(result.verified).toBe(false);
    expect(result.items[0]?.record?.lifecycle).toBe('draft');
    expect(await candidates.listCandidates('sess-fixed')).toHaveLength(0);
    await expect(write.write({
      spaceId: 'user',
      card: { ...factCard(), lifecycle: 'verified', sourceStatus: 'fixed' },
      permissionMode: 'full-access',
      confirmation: { explicitHumanConfirmation: true },
    })).rejects.toBeInstanceOf(KnowledgeLifecycleError);
    await expect(write.promote({
      spaceId: 'user',
      card: { ...factCard(), lifecycle: 'candidate', sourceStatus: 'fixed' },
      to: 'verified',
      permissionMode: 'full-access',
      confirmation: { explicitHumanConfirmation: true },
    })).rejects.toBeInstanceOf(KnowledgeLifecycleError);
  });

  it('marks the index revision stale after an external card edit', async () => {
    const root = tempRoot('rdc-know-stale-');
    mkdirSync(path.join(root, 'facts'), { recursive: true });
    const cardPath = path.join(root, 'facts', 'sample.md');
    writeFileSync(cardPath, serializeKnowledgeCard(factCard()), 'utf8');
    const files = new Map<string, unknown>();
    const index = new KnowledgeIndexService({
      listSpaces: () => [{ spaceId: 'user', kind: 'user', label: 'User', rootPath: root }],
      snapshotPath: () => path.join(root, 'index.json'),
      storage: {
        ensureDir: () => undefined,
        readJson: (filePath: string) => (files.has(filePath) ? files.get(filePath) : null),
        writeJsonAtomic: (filePath: string, data: unknown) => {
          files.set(filePath, data);
        },
      } as unknown as StorageIo,
      now: () => new Date('2026-09-01T00:00:00.000Z'),
      readFile: (filePath) => readFile(filePath, 'utf8'),
      statMtime: async (filePath) => Math.trunc((await stat(filePath)).mtimeMs),
    });
    const first = await index.rebuild();
    expect(await index.isSnapshotStale(first)).toBe(false);
    writeFileSync(cardPath, `${readFileSync(cardPath, 'utf8')}\n\nEdited externally.\n`, 'utf8');
    expect(await index.isSnapshotStale(first)).toBe(true);
    const rebuilt = await index.getOrRebuild();
    expect(rebuilt.revision).not.toBe(first.revision);
    expect(rebuilt.cards[0]?.contentHash).not.toBe(first.cards[0]?.contentHash);
  });

  it('serializes import source fingerprints into canonical card frontmatter', () => {
    const card: KnowledgeCardRecord = {
      ...factCard(),
      sourceHash: 'ab'.repeat(32),
      sourceMtimeMs: 1_700_000_000_000,
      sourceSize: 4096,
      sourceStatus: 'fixed',
      caseId: 'AIRD-20260207-0002',
    };
    const parsed = parseKnowledgeFrontmatter(serializeKnowledgeCard(card));
    expect(parsed.record.sourceHash).toBe(card.sourceHash);
    expect(parsed.record.sourceMtimeMs).toBe(card.sourceMtimeMs);
    expect(parsed.record.sourceSize).toBe(card.sourceSize);
    expect(parsed.record.sourceStatus).toBe('fixed');
    expect(parsed.record.caseId).toBe('AIRD-20260207-0002');
  });

  it('drops filename-shaped provenance tokens and keeps short case ids', () => {
    expect(sanitizeProvenanceToken('fixed')).toBe('fixed');
    expect(sanitizeProvenanceToken('AIRD-20260207-0002')).toBe('AIRD-20260207-0002');
    expect(sanitizeProvenanceToken('企业微信截图_1.png')).toBeUndefined();
    expect(sanitizeProvenanceToken('HairBlackSpirV.txt')).toBeUndefined();
    expect(sanitizeProvenanceToken('C:/capture.rdc')).toBeUndefined();
  });
});

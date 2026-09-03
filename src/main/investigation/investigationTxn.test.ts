import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SESSION_ARTIFACT_ROOT_DIR } from '@shared/types/sessionArtifact';
import { InvestigationError } from './investigationErrors';
import { sha256Prefixed } from './investigationHash';
import {
  SESSION_B_ID,
  SESSION_ID,
  baselineWorld,
  createInvestigationHarness,
  createMultiSessionInvestigationHarness,
  evidenceOf,
  exclusiveWorld,
  reopenInvestigationHarness,
  seedNote,
  writeDraft,
} from './investigationTestFixtures';
import {
  INVESTIGATION_PERSIST_BOUNDARIES,
  INVESTIGATION_TXN_COMMIT,
  INVESTIGATION_TXN_DIR,
  INVESTIGATION_TXN_JOURNAL,
  INVESTIGATION_TXN_LOCK,
  type InvestigationPersistBoundary,
} from './investigationTxn';

const PRE_COMMIT = new Set<InvestigationPersistBoundary>([
  'journal',
  'temp:content',
  'temp:manifest',
  'temp:supersede',
  'temp:stale',
  'temp:index',
]);

function indexPath(sessionPath: string): string {
  return path.join(sessionPath, SESSION_ARTIFACT_ROOT_DIR, 'investigation', 'index.json');
}

function recordPath(sessionPath: string, artifactId: string): string {
  return path.join(sessionPath, SESSION_ARTIFACT_ROOT_DIR, 'investigation', 'records', `${artifactId}.json`);
}

function txnDir(sessionPath: string): string {
  return path.join(sessionPath, INVESTIGATION_TXN_DIR);
}

function readIndexIds(sessionPath: string): string[] {
  const raw = JSON.parse(readFileSync(indexPath(sessionPath), 'utf8')) as {
    artifacts: Array<{ artifactId: string; status: string; recordKey: string }>;
  };
  return raw.artifacts.map((entry) => `${entry.artifactId}:${entry.status}:${entry.recordKey}`);
}

function assertComplete(sessionPath: string, expected: string[]): void {
  expect(existsSync(indexPath(sessionPath))).toBe(true);
  expect(readIndexIds(sessionPath)).toEqual(expected);
  for (const token of expected) {
    const artifactId = token.split(':')[0]!;
    expect(existsSync(recordPath(sessionPath, artifactId))).toBe(true);
  }
  const leftovers = existsSync(txnDir(sessionPath))
    ? require('node:fs').readdirSync(txnDir(sessionPath)).filter((name: string) => name !== INVESTIGATION_TXN_LOCK)
    : [];
  expect(leftovers).toEqual([]);
}

describe('InvestigationArtifactService transactions', () => {
  it('fault-injects every persist boundary and recovers to a complete old or new store', { timeout: 30_000 }, () => {
    expect(INVESTIGATION_PERSIST_BOUNDARIES.length).toBeGreaterThanOrEqual(13);
    const seen = new Set<InvestigationPersistBoundary>();
    for (const boundary of INVESTIGATION_PERSIST_BOUNDARIES) {
      const seeded = createInvestigationHarness('rdc-inv-fault-');
      const note = seedNote(seeded.resolver);
      const world = writeDraft(seeded.service, 'world_state', baselineWorld('ws-txn'));
      const evidence = writeDraft(seeded.service, 'evidence', evidenceOf('ws-txn', note, 'ev-txn'));
      const oldIds = readIndexIds(seeded.sessionPath);
      let fired = false;
      const crashing = reopenInvestigationHarness(seeded.sessionPath, {
        onPersistBoundary: (current) => {
          seen.add(current);
          if (current === boundary && !fired) {
            fired = true;
            throw new Error(`fault:${boundary}`);
          }
        },
      });
      expect(() => crashing.service.writeRecord(SESSION_ID, {
        kind: 'world_state',
        mission: 'debugger',
        title: 'pollute',
        summary: 'txn fault',
        record: {
          ...exclusiveWorld('ws-txn', true),
          replay: { adapter: 'vk', driver: 'adreno', device: 'device-0', exclusiveLock: false },
        },
        supersedes: world.manifest.artifactId,
      })).toThrow(new RegExp(`fault:${boundary.replace(':', '\\:')}|INVESTIGATION_`));
      const recovered = reopenInvestigationHarness(seeded.sessionPath);
      const ids = recovered.service.list(SESSION_ID).map((entry) => (
        `${entry.artifactId}:${entry.status}:${entry.recordKey}`
      ));
      if (PRE_COMMIT.has(boundary)) {
        expect(ids).toEqual(oldIds);
        expect(recovered.service.readRecord(SESSION_ID, world.manifest.artifactId).manifest.status).toBe('draft');
        expect(recovered.service.readRecord(SESSION_ID, evidence.manifest.artifactId).record).toMatchObject({
          stale: false,
        });
      } else {
        expect(ids).not.toEqual(oldIds);
        expect(recovered.service.readRecord(SESSION_ID, world.manifest.artifactId).manifest.status).toBe('superseded');
        expect(recovered.service.readRecord(SESSION_ID, evidence.manifest.artifactId).record).toMatchObject({
          stale: true,
        });
        expect(ids.some((token) => token.endsWith(':ws-txn') && token.includes(':draft:'))).toBe(true);
      }
      assertComplete(seeded.sessionPath, ids);
    }
    expect([...seen].sort()).toEqual([...INVESTIGATION_PERSIST_BOUNDARIES].sort());
  });

  it('treats leftover corrupt commit residue as degraded instead of empty', () => {
    const { sessionPath, service } = createInvestigationHarness('rdc-inv-deg-');
    writeDraft(service, 'world_state', baselineWorld('ws-deg'));
    const root = txnDir(sessionPath);
    mkdirSync(root, { recursive: true });
    writeFileSync(path.join(root, INVESTIGATION_TXN_COMMIT), '{not-json', 'utf8');
    writeFileSync(path.join(root, INVESTIGATION_TXN_JOURNAL), '{also-bad', 'utf8');
    const restarted = reopenInvestigationHarness(sessionPath);
    expect(() => restarted.service.list(SESSION_ID)).toThrow(/INVESTIGATION_DEGRADED/);
    expect(restarted.service.listForProjection(SESSION_ID)).toEqual({ artifacts: [], storeDegraded: true });
    expect(existsSync(path.join(root, INVESTIGATION_TXN_COMMIT))).toBe(true);
  });

  it('does not silently rollback a corrupt journal that has no commit marker', () => {
    const { sessionPath, service } = createInvestigationHarness('rdc-inv-journal-bad-');
    writeDraft(service, 'world_state', baselineWorld('ws-journal-bad'));
    const root = txnDir(sessionPath);
    mkdirSync(root, { recursive: true });
    writeFileSync(path.join(root, INVESTIGATION_TXN_JOURNAL), '{not-json', 'utf8');
    const restarted = reopenInvestigationHarness(sessionPath);
    expect(() => restarted.service.list(SESSION_ID)).toThrow(/INVESTIGATION_DEGRADED/);
    const projection = restarted.service.listForProjection(SESSION_ID);
    expect(projection.storeDegraded).toBe(true);
    expect(projection.artifacts).toEqual([]);
    expect(existsSync(path.join(root, INVESTIGATION_TXN_JOURNAL))).toBe(true);
  });

  it('rejects incomplete journal and inconsistent commit metadata as degraded', () => {
    const { sessionPath, service } = createInvestigationHarness('rdc-inv-meta-');
    writeDraft(service, 'world_state', baselineWorld('ws-meta'));
    const root = txnDir(sessionPath);
    mkdirSync(root, { recursive: true });
    const mutation = {
      uri: 'session://investigation/records/art-x.json',
      role: 'content',
      contentHash: sha256Prefixed('{"ok":true}\n'),
      stagingName: '000-content.json',
    };
    writeFileSync(path.join(root, INVESTIGATION_TXN_JOURNAL), `${JSON.stringify({
      schemaVersion: 1,
      txnId: 'invtxn-incomplete',
      sessionId: SESSION_ID,
      createdAt: '2026-09-01T00:00:00.000Z',
      mutations: [],
    })}\n`, 'utf8');
    const incomplete = reopenInvestigationHarness(sessionPath);
    expect(() => incomplete.service.list(SESSION_ID)).toThrow(/INVESTIGATION_DEGRADED/);
    expect(incomplete.service.listForProjection(SESSION_ID).storeDegraded).toBe(true);

    writeFileSync(path.join(root, INVESTIGATION_TXN_JOURNAL), `${JSON.stringify({
      schemaVersion: 1,
      txnId: 'invtxn-journal',
      sessionId: SESSION_ID,
      createdAt: '2026-09-01T00:00:00.000Z',
      mutations: [mutation],
    })}\n`, 'utf8');
    writeFileSync(path.join(root, INVESTIGATION_TXN_COMMIT), `${JSON.stringify({
      schemaVersion: 1,
      txnId: 'invtxn-other',
      mutationCount: 1,
      planHash: sha256Prefixed(JSON.stringify([mutation])),
      mutations: [mutation],
    })}\n`, 'utf8');
    const mismatched = reopenInvestigationHarness(sessionPath);
    expect(() => mismatched.service.list(SESSION_ID)).toThrow(/INVESTIGATION_DEGRADED/);
    expect(mismatched.service.listForProjection(SESSION_ID)).toMatchObject({
      artifacts: [],
      storeDegraded: true,
    });
  });

  it('does not disguise a missing index with sibling records as empty', () => {
    const { sessionPath, service } = createInvestigationHarness('rdc-inv-miss-');
    const written = writeDraft(service, 'world_state', baselineWorld('ws-miss'));
    unlinkSync(indexPath(sessionPath));
    expect(existsSync(recordPath(sessionPath, written.manifest.artifactId))).toBe(true);
    const restarted = reopenInvestigationHarness(sessionPath);
    expect(() => restarted.service.list(SESSION_ID)).toThrow(/INVESTIGATION_INDEX_MISSING|INVESTIGATION_DEGRADED/);
    expect(() => writeDraft(restarted.service, 'world_state', baselineWorld('ws-miss-2')))
      .toThrow(/INVESTIGATION_INDEX_MISSING|INVESTIGATION_DEGRADED/);
  });

  it('isolates writes across sessions and rejects duplicate ids inside one session', () => {
    const { service } = createMultiSessionInvestigationHarness();
    const first = service.writeRecord(SESSION_ID, {
      kind: 'world_state',
      mission: 'debugger',
      title: 'A',
      summary: 'A',
      record: baselineWorld('ws-shared'),
      artifactId: 'art-shared',
    });
    const other = service.writeRecord(SESSION_B_ID, {
      kind: 'world_state',
      mission: 'debugger',
      title: 'B',
      summary: 'B',
      record: baselineWorld('ws-shared'),
      artifactId: 'art-shared',
    });
    expect(first.manifest.artifactId).toBe('art-shared');
    expect(other.manifest.artifactId).toBe('art-shared');
    expect(service.list(SESSION_ID)).toHaveLength(1);
    expect(service.list(SESSION_B_ID)).toHaveLength(1);
    expect(() => service.readRecord(SESSION_B_ID, first.manifest.artifactId).record)
      .not.toThrow();
    expect(() => service.writeRecord(SESSION_ID, {
      kind: 'world_state',
      mission: 'debugger',
      title: 'dup',
      summary: 'dup',
      record: baselineWorld('ws-other'),
      artifactId: 'art-shared',
    })).toThrow(/INVESTIGATION_DUPLICATE_ID/);
    expect(() => service.writeRecord(null, {
      kind: 'world_state',
      mission: 'debugger',
      title: 'denied',
      summary: 'denied',
      record: baselineWorld('ws-x'),
    })).toThrow(InvestigationError);
  });

  it('times out when another owner holds the session txn lock', () => {
    const { sessionPath, service } = createInvestigationHarness('rdc-inv-lock-');
    mkdirSync(txnDir(sessionPath), { recursive: true });
    writeFileSync(path.join(txnDir(sessionPath), INVESTIGATION_TXN_LOCK), JSON.stringify({
      pid: process.pid,
      createdAt: Date.now(),
    }), 'utf8');
    const blocked = reopenInvestigationHarness(sessionPath, { lockMaxAttempts: 2 });
    expect(() => writeDraft(blocked.service, 'world_state', baselineWorld('ws-lock')))
      .toThrow(/INVESTIGATION_STORAGE_FAILED|INVESTIGATION_TXN_LOCK_TIMEOUT/);
    unlinkSync(path.join(txnDir(sessionPath), INVESTIGATION_TXN_LOCK));
    expect(writeDraft(service, 'world_state', baselineWorld('ws-lock')).manifest.kind).toBe('world_state');
  });

  it('recovers a first write that crashes after the commit marker to the complete new version', () => {
    const { sessionPath } = createInvestigationHarness('rdc-inv-first-');
    const crashing = reopenInvestigationHarness(sessionPath, {
      onPersistBoundary: (boundary) => {
        if (boundary === 'commit-marker') throw new Error('fault:first-commit');
      },
    });
    expect(() => writeDraft(crashing.service, 'world_state', baselineWorld('ws-first')))
      .toThrow(/fault:first-commit|INVESTIGATION_/);
    const recovered = reopenInvestigationHarness(sessionPath);
    expect(recovered.service.list(SESSION_ID)).toHaveLength(1);
    expect(recovered.service.list(SESSION_ID)[0]?.recordKey).toBe('ws-first');
  });

  it('recovers a first write that crashes before commit to an honest empty store', () => {
    const { sessionPath } = createInvestigationHarness('rdc-inv-empty-');
    const crashing = reopenInvestigationHarness(sessionPath, {
      onPersistBoundary: (boundary) => {
        if (boundary === 'journal') throw new Error('fault:first-journal');
      },
    });
    expect(() => writeDraft(crashing.service, 'world_state', baselineWorld('ws-empty')))
      .toThrow(/fault:first-journal|INVESTIGATION_/);
    const recovered = reopenInvestigationHarness(sessionPath);
    expect(recovered.service.list(SESSION_ID)).toEqual([]);
  });
});

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { InvestigationArtifactManifest } from '@shared/types/renderdocInvestigation';
import { SESSION_ARTIFACT_ROOT_DIR } from '@shared/types/sessionArtifact';
import type { InvestigationIndexEntry } from '../investigation/investigationRecordKeys';
import {
  SESSION_ID,
  baselineWorld,
  createInvestigationHarness,
  overwriteInvestigationManifest,
  writeDraft,
} from '../investigation/investigationTestFixtures';
import {
  mapRightRailInvestigationArtifacts,
  type InvestigationArtifactsSource,
  type InvestigationListSnapshot,
} from './rightRailInvestigationArtifacts';
import { mapRightRailOutputs } from './rightRailProjectionMappers';

const entry = (
  artifactId: string,
  createdAt: string,
  extras: Partial<InvestigationIndexEntry> = {},
): InvestigationIndexEntry => ({
  artifactId,
  kind: extras.kind ?? 'evidence',
  recordType: extras.recordType ?? 'EvidenceRecord',
  status: extras.status ?? 'ready',
  contentUri: `rdx://investigation/records/${artifactId}.json`,
  manifestUri: `rdx://investigation/manifests/${artifactId}.json`,
  contentHash: extras.contentHash ?? 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  createdAt,
  supersedes: extras.supersedes,
  recordKey: extras.recordKey ?? artifactId,
});

const manifestOf = (
  artifactId: string,
  extras: Partial<InvestigationArtifactManifest> = {},
): InvestigationArtifactManifest => ({
  artifactId,
  mission: extras.mission ?? 'debugger',
  kind: extras.kind ?? 'evidence',
  status: extras.status ?? 'ready',
  title: extras.title ?? artifactId,
  summary: extras.summary ?? '',
  contentRef: extras.contentRef ?? `rdx://investigation/records/${artifactId}.json`,
  sourceRefs: extras.sourceRefs ?? [{ artifactId: 'src-1', expectedHash: 'sha256:1' }],
  contentHash: extras.contentHash ?? 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  recordType: extras.recordType ?? 'EvidenceRecord',
  worldStateId: extras.worldStateId,
  supersedes: extras.supersedes,
  createdAt: extras.createdAt ?? '2026-01-01T00:00:00.000Z',
});

const sourceOf = (
  entries: InvestigationIndexEntry[],
  manifests: Array<[string, InvestigationArtifactManifest | null]> = [],
  listImpl?: () => InvestigationListSnapshot,
): InvestigationArtifactsSource => ({
  listForProjection: listImpl ?? (() => ({ artifacts: entries, storeDegraded: false })),
  listManifests: () => new Map(manifests),
});

describe('mapRightRailInvestigationArtifacts', () => {
  it('keeps createdAt order and artifactId tie-break', () => {
    const late = entry('b-late', '2026-01-02T00:00:00.000Z');
    const earlyB = entry('b-early', '2026-01-01T00:00:00.000Z');
    const earlyA = entry('a-early', '2026-01-01T00:00:00.000Z');
    const result = mapRightRailInvestigationArtifacts('session-a', sourceOf(
      [late, earlyB, earlyA],
      [earlyA, earlyB, late].map((item) => [item.artifactId, manifestOf(item.artifactId)]),
    ));
    expect(result.rows.map((row) => row.artifactId)).toEqual(['a-early', 'b-early', 'b-late']);
    expect(result.rows.every((row) => !row.degraded)).toBe(true);
  });

  it('counts superseded ids and keeps them out of rows', () => {
    const old = entry('old', '2026-01-01T00:00:00.000Z', { status: 'superseded' });
    const next = entry('next', '2026-01-02T00:00:00.000Z', { supersedes: 'old' });
    const result = mapRightRailInvestigationArtifacts('session-a', sourceOf(
      [old, next],
      [[old.artifactId, manifestOf('old')], [next.artifactId, manifestOf('next')]],
    ));
    expect(result.rows.map((row) => row.artifactId)).toEqual(['next']);
    expect(result.supersededCount).toBe(1);
  });

  it('keeps the newest 50 visible rows and counts earlier truncated records', () => {
    const entries = Array.from({ length: 52 }, (_, index) => {
      const id = `art-${String(index).padStart(2, '0')}`;
      return entry(id, `2026-01-01T00:00:${String(index).padStart(2, '0')}.000Z`);
    });
    const result = mapRightRailInvestigationArtifacts('session-a', sourceOf(
      entries,
      entries.map((item) => [item.artifactId, manifestOf(item.artifactId)]),
    ));
    expect(result.rows).toHaveLength(50);
    expect(result.truncatedCount).toBe(2);
    expect(result.rows[0]?.artifactId).toBe('art-02');
    expect(result.rows[49]?.artifactId).toBe('art-51');
    expect(result.rows.map((row) => row.artifactId)).not.toContain('art-00');
    expect(result.rows.map((row) => row.artifactId)).not.toContain('art-01');
  });

  it('marks a missing or mismatched manifest as degraded instead of dropping the row', () => {
    const missing = entry('missing', '2026-01-01T00:00:00.000Z');
    const drifted = entry('drifted', '2026-01-02T00:00:00.000Z');
    const result = mapRightRailInvestigationArtifacts('session-a', sourceOf(
      [missing, drifted],
      [[drifted.artifactId, manifestOf('drifted', { contentHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' })]],
    ));
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({ artifactId: 'missing', degraded: true, title: '' });
    expect(result.rows[1]).toMatchObject({ artifactId: 'drifted', degraded: true, title: '' });
  });

  it('keeps a valid row when a sibling manifest is drifted', () => {
    const { resolver, service } = createInvestigationHarness();
    const good = writeDraft(service, 'world_state', baselineWorld('ws-good'), { title: 'good world' });
    const bad = writeDraft(service, 'world_state', baselineWorld('ws-bad'), { title: 'bad world' });
    overwriteInvestigationManifest(resolver, bad.manifest.artifactId, {
      contentHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    });
    expect(() => service.list(SESSION_ID)).toThrow(/INVESTIGATION_INDEX_CORRUPT|INVESTIGATION_HASH_MISMATCH/);
    const result = mapRightRailInvestigationArtifacts(SESSION_ID, service);
    expect(result.rows).toHaveLength(2);
    expect(result.rows.find((row) => row.artifactId === good.manifest.artifactId))
      .toMatchObject({ degraded: false, title: 'good world' });
    expect(result.rows.find((row) => row.artifactId === bad.manifest.artifactId))
      .toMatchObject({ degraded: true, title: '' });
  });

  it('empties the card only when the investigation index itself is unavailable', () => {
    const { sessionPath, service } = createInvestigationHarness();
    writeDraft(service, 'world_state', baselineWorld('ws-idx'));
    writeFileSync(
      path.join(sessionPath, SESSION_ARTIFACT_ROOT_DIR, 'investigation', 'index.json'),
      '{not-json',
      'utf8',
    );
    expect(() => service.list(SESSION_ID)).toThrow(/INVESTIGATION_INDEX_CORRUPT/);
    expect(mapRightRailInvestigationArtifacts(SESSION_ID, service)).toEqual({
      rows: [],
      supersededCount: 0,
      truncatedCount: 0,
      storeDegraded: true,
    });
  });

  it('returns an honest empty view model when the index itself is unavailable', () => {
    const result = mapRightRailInvestigationArtifacts('session-a', sourceOf([], [], () => {
      throw new Error('INVESTIGATION_INDEX_CORRUPT');
    }));
    expect(result).toEqual({ rows: [], supersededCount: 0, truncatedCount: 0, storeDegraded: true });
  });

  it('does not mix output_register files into investigation rows', () => {
    const investigation = mapRightRailInvestigationArtifacts('session-a', sourceOf(
      [entry('inv-1', '2026-01-01T00:00:00.000Z')],
      [['inv-1', manifestOf('inv-1')]],
    ));
    const outputs = mapRightRailOutputs({
      sessionId: 'session-a',
      branchId: 'branch-a',
      runs: [{ runId: 'run-1', startedAt: 1 } as never],
      sources: [{
        id: 'out-1', kind: 'output', runId: 'run-1', title: 'report.md', fileName: 'report.md',
        filePath: 'D:/out/report.md', source: 'report', mimeType: 'text/markdown', sizeBytes: 12,
        createdAt: 1, updatedAt: 1, exists: true,
      }],
    });
    expect(investigation.rows.some((row) => row.artifactId === 'out-1' || 'path' in row)).toBe(false);
    expect(outputs.current.some((item) => item.id === 'inv-1')).toBe(false);
    expect(outputs.current.map((item) => item.id)).toEqual(['out-1']);
  });
});

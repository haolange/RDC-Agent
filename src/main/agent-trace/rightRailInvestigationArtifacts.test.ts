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
  listInvestigationArtifacts,
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
  contentUri: `rdc://investigation/records/${artifactId}.json`,
  manifestUri: `rdc://investigation/manifests/${artifactId}.json`,
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
  contentRef: extras.contentRef ?? `rdc://investigation/records/${artifactId}.json`,
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
    expect(result.rows.map((row) => row.artifactId)).toEqual(['b-late', 'b-early', 'a-early']);
    expect(result.rows.every((row) => !row.degraded)).toBe(true);
    expect(result.rows.every((row) => row.contentHash.startsWith('sha256:') && row.contentHash.length === 71)).toBe(true);
    expect(result.rows.every((row) => row.contentHashShort === 'sha256:aaaaaaaaaaaa')).toBe(true);
  });

  it('counts superseded ids and keeps them out of rows', () => {
    const old = entry('old', '2026-01-01T00:00:00.000Z', { status: 'superseded' });
    const next = entry('next', '2026-01-02T00:00:00.000Z', { supersedes: 'old' });
    const result = mapRightRailInvestigationArtifacts('session-a', sourceOf(
      [old, next],
      [[old.artifactId, manifestOf('old')], [next.artifactId, manifestOf('next')]],
    ));
    expect(result.rows.map((row) => row.artifactId)).toEqual(['next']);
    expect(result.totalCount).toBe(1);
  });

  it('projects newest five and pages beyond fifty without dropping or repeating ties', () => {
    const entries = Array.from({ length: 57 }, (_, index) => entry(`art-${String(index).padStart(3, '0')}`, '2026-01-01T00:00:00.000Z'));
    const source = sourceOf(entries, entries.map(item => [item.artifactId, manifestOf(item.artifactId)]));
    const result = mapRightRailInvestigationArtifacts('session-a', source);
    expect(result.totalCount).toBe(57);
    expect(result.rows.map(row => row.artifactId)).toEqual(['art-056','art-055','art-054','art-053','art-052']);
    const first = listInvestigationArtifacts('session-a', undefined, source);
    expect(first.rows).toHaveLength(50);
    expect(first.nextCursor).toEqual({ createdAt: entries[0].createdAt, artifactId: 'art-007' });
    const second = listInvestigationArtifacts('session-a', first.nextCursor, source);
    expect(second.rows).toHaveLength(7);
    expect(second.nextCursor).toBeUndefined();
    expect(new Set([...first.rows,...second.rows].map(row => row.artifactId)).size).toBe(57);
    expect(second.rows.at(-1)?.artifactId).toBe('art-000');
  });

  it('marks a missing or mismatched manifest as degraded instead of dropping the row', () => {
    const missing = entry('missing', '2026-01-01T00:00:00.000Z');
    const drifted = entry('drifted', '2026-01-02T00:00:00.000Z');
    const result = mapRightRailInvestigationArtifacts('session-a', sourceOf(
      [missing, drifted],
      [[drifted.artifactId, manifestOf('drifted', { contentHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' })]],
    ));
    expect(result.rows).toHaveLength(2);
    expect(result.rows[1]).toMatchObject({
      artifactId: 'missing',
      degraded: true,
      title: '',
      mission: 'unknown',
      contentHash: missing.contentHash,
    });
    expect(result.rows[0]).toMatchObject({
      artifactId: 'drifted',
      degraded: true,
      title: '',
      mission: 'debugger',
      contentHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    });
    expect(result.rows[1]?.contentHashShort).toBe('sha256:aaaaaaaaaaaa');
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
      totalCount: 0,
      storeDegraded: true,
    });
  });

  it('returns an honest empty view model when the index itself is unavailable', () => {
    const result = mapRightRailInvestigationArtifacts('session-a', sourceOf([], [], () => {
      throw new Error('INVESTIGATION_INDEX_CORRUPT');
    }));
    expect(result).toEqual({ rows: [], totalCount: 0, storeDegraded: true });
  });

  it('does not invent a debugger mission when the manifest is missing', () => {
    const orphan = entry('orphan', '2026-01-01T00:00:00.000Z');
    const result = mapRightRailInvestigationArtifacts('session-a', sourceOf([orphan], []));
    expect(result.rows[0]).toMatchObject({
      artifactId: 'orphan',
      mission: 'unknown',
      degraded: true,
      contentHash: orphan.contentHash,
    });
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

it('does not report a failed filesystem read as an empty successful page', () => {
  const source = sourceOf([], [], () => { throw new Error('EACCES'); });
  expect(listInvestigationArtifacts('session-a', undefined, source)).toEqual({ rows: [], totalCount: 0, storeDegraded: true });
});

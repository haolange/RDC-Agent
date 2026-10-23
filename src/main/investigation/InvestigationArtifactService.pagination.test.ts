import { appendFileSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ARTIFACT_READ_MAX_OUTPUT_BYTES } from '@shared/types/sessionArtifact';
import { baselineWorld, createInvestigationHarness, SESSION_ID, writeDraft } from './investigationTestFixtures';

function withHarness(run: (harness: ReturnType<typeof createInvestigationHarness>) => void) {
  const harness = createInvestigationHarness('rdc-inv-pagination-');
  const root = realpathSync(harness.sessionPath);
  if (path.dirname(root) !== realpathSync(tmpdir()) || !path.basename(root).startsWith('rdc-inv-pagination-')) {
    throw new Error('Unexpected fixture cleanup boundary.');
  }
  try { run(harness); } finally { rmSync(root, { recursive: true, force: true }); }
}

const indexUri = 'session://investigation/index.json';

describe('Investigation internal complete reads', () => {
  it('continues reading and writing a valid index beyond the model output window', () => withHarness(({ resolver, service }) => {
    const first = writeDraft(service, 'world_state', baselineWorld('ws-first'));
    const target = resolver.resolve(SESSION_ID, indexUri).absolutePath;
    // Legal JSON whitespace crosses the output window without changing index semantics or the file quota.
    appendFileSync(target, ' '.repeat(ARTIFACT_READ_MAX_OUTPUT_BYTES));
    expect(() => JSON.parse(readFileSync(target, 'utf8'))).not.toThrow();
    expect(resolver.read(SESSION_ID, indexUri).truncated).toBe(true);
    expect(service.list(SESSION_ID).map(item => item.artifactId)).toEqual([first.manifest.artifactId]);
    const next = writeDraft(service, 'world_state', baselineWorld('ws-second'));
    expect(service.readRecord(SESSION_ID, next.manifest.artifactId).record).toMatchObject({ worldStateId: 'ws-second' });
    expect(service.list(SESSION_ID)).toHaveLength(2);
  }));

  it('verifies a legitimately written record body larger than one output page', () => withHarness(({ service }) => {
    const reason = 'bounded rationale '.repeat(Math.ceil(ARTIFACT_READ_MAX_OUTPUT_BYTES / 10)).trim();
    const world = { ...baselineWorld('ws-large-body'), benchmark: { status: 'not_measured' as const, reason } };
    const saved = writeDraft(service, 'world_state', world);
    const read = service.readRecord(SESSION_ID, saved.manifest.artifactId, saved.contentHash);
    expect(read.record).toEqual(world);
  }));

  it('refuses an index changed between pages', () => withHarness(({ resolver, service }) => {
    writeDraft(service, 'world_state', baselineWorld('ws-change'));
    const target = resolver.resolve(SESSION_ID, indexUri).absolutePath;
    appendFileSync(target, ' '.repeat(ARTIFACT_READ_MAX_OUTPUT_BYTES));
    const originalRead = resolver.read.bind(resolver);
    const spy = vi.spyOn(resolver, 'read').mockImplementation((session, uri, options) => {
      if (uri === indexUri && options?.expectedHash) appendFileSync(target, ' ');
      return originalRead(session, uri, options);
    });
    try {
      expect(() => service.list(SESSION_ID)).toThrow(/INVESTIGATION_INDEX_CORRUPT/);
      expect(spy.mock.calls.some(([, uri, options]) => uri === indexUri && Boolean(options?.expectedHash))).toBe(true);
    }
    finally { spy.mockRestore(); }
  }));
});

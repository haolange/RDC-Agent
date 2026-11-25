import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ runRoot: '' }));
vi.mock('../sessions/store/StorageAdapter', () => ({ storageAdapter: { getRunPath: () => fixture.runRoot } }));
import { artifactStore } from './ArtifactStore';

afterEach(() => { if (fixture.runRoot) fs.rmSync(fixture.runRoot, { recursive: true, force: true }); });

it('reports a damaged artifact store instead of replacing it with an empty one', () => {
  fixture.runRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-artifact-store-'));
  expect(artifactStore.list('session', 'run')).toEqual([]);
  fs.writeFileSync(path.join(fixture.runRoot, 'artifact_store.json'), JSON.stringify({ schemaVersion: '1', runId: 'run', sessionId: 'session', artifacts: [{ artifactId: 'a' }], updatedAt: 'now' }));
  expect(() => artifactStore.list('session', 'run')).toThrow(expect.objectContaining({ code: 'STORAGE_CORRUPT' }));
});

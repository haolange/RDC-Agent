import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ sessionPath: '' }));
vi.mock('../../sessions/store/sessionStores', () => ({ sessionRecordStore: { readSession: () => ({ sessionPath: fixture.sessionPath }) } }));
import { traceStateStore } from './TraceStateStore';

afterEach(() => { if (fixture.sessionPath) fs.rmSync(fixture.sessionPath, { recursive: true, force: true }); });

it('reports a damaged request tree instead of replacing it with an empty one', () => {
  fixture.sessionPath = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-trace-state-'));
  expect(traceStateStore.read('session').userRequests).toEqual([]);
  traceStateStore.ensureRunRequest({ sessionId: 'session', runId: 'run', prompt: 'Inspect', traceLaneId: 'lane' });
  const file = path.join(fixture.sessionPath, 'agentic-trace-state.json');
  fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), userRequests: 'none' }));
  expect(() => traceStateStore.read('session')).toThrow(expect.objectContaining({ code: 'STORAGE_CORRUPT' }));
});

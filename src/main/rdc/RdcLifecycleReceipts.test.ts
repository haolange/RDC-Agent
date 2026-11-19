import { expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import { createInvestigationHarness, SESSION_ID } from '../investigation/investigationTestFixtures';
import { RdcLifecycleReceipts, type RdcLifecycleReceipt } from './RdcLifecycleReceipts';

it('persists a main-signed lifecycle intent and rejects altered or foreign receipts', () => {
  const { resolver, sessionPath } = createInvestigationHarness();
  const receipts = new RdcLifecycleReceipts(resolver, () => 'test-key');
  const value: RdcLifecycleReceipt = { schemaVersion: 1, event: 'intent', sessionId: SESSION_ID, projectId: 'p', turnId: 't', operationId: 'op',
    planUri: 'session://plans/p.md', planHash: 'a'.repeat(64), recordedAt: 1, original: null, from: null,
    destination: { inputId: 'input', contentSha256: 'b'.repeat(64), deviceId: 'device' } };
  try {
    const ref = receipts.write(value);
    expect(receipts.read(SESSION_ID, ref)).toEqual(value);
    expect(() => new RdcLifecycleReceipts(resolver, () => 'wrong-key').read(SESSION_ID, ref)).toThrow('signature mismatch');
    expect(() => receipts.read(SESSION_ID, { ...ref, expectedHash: `sha256:${'c'.repeat(64)}` })).toThrow();
    expect(() => receipts.write({ ...value, planHash: 'bad' })).toThrow();
  } finally { rmSync(sessionPath, { recursive: true, force: true }); }
});

it('finds an unresolved signed baseline after restart and closes only the matching restored position', () => {
  const { resolver, sessionPath } = createInvestigationHarness();
  const receipts = new RdcLifecycleReceipts(resolver, () => 'test-key');
  const base = { schemaVersion: 1 as const, sessionId: SESSION_ID, projectId: 'p', turnId: 't', operationId: 'op',
    planUri: 'session://plans/p.md', planHash: 'a'.repeat(64), recordedAt: 1 };
  const original = { inputId: 'input', contentSha256: 'b'.repeat(64), deviceId: 'device', target: null, isFinalOutput: false,
    native: { contextId: 'old', leaseVersion: 1, replaySessionId: 'replay', captureFileId: 'capture', eventId: 10,
      replacementCount: 0, replacementFingerprint: 'c'.repeat(64), processIdentity: { status: 'available',
        daemon: { pid: 10, start_generation: 'windows-filetime:1' }, worker: { pid: 11, start_generation: 'windows-filetime:2' } } } };
  try {
    const baseline = receipts.write({ ...base, event: 'baseline', original });
    expect(new RdcLifecycleReceipts(resolver, () => 'test-key').pending(SESSION_ID, 'p')).toMatchObject({ ref: baseline, count: 1 });
    receipts.write({ ...base, operationId: 'wrong', recordedAt: 2, event: 'resolved', baseline,
      observed: { ...original, native: { ...original.native, eventId: 11 } } });
    expect(receipts.pending(SESSION_ID, 'p')).not.toBeNull();
    receipts.write({ ...base, operationId: 'right', recordedAt: 3, event: 'resolved', baseline,
      observed: { ...original, native: { ...original.native, contextId: 'new', leaseVersion: 2 } } });
    expect(receipts.pending(SESSION_ID, 'p')).toBeNull();
    expect(() => new RdcLifecycleReceipts(resolver, () => 'wrong-key').pending(SESSION_ID, 'p')).toThrow('signature mismatch');
  } finally { rmSync(sessionPath, { recursive: true, force: true }); }
});

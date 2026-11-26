import { expect, it, vi } from 'vitest';
import { bindRdcTurn, freezeRdcTurnBinding, getRdcTurnBinding } from '../../rdc/RdcTurnBindings';
import { noteRdcProcessIdentity } from '../../rdc/RdcProcessIdentity';
import { TurnHandle } from './TurnCoordinator';
import { ApprovedCaptureController, type ApprovedCaptureHost } from './ApprovedCaptureController';
import type { PromptPlan } from '@shared/types/rdcRuntime';
import type { RdcLifecyclePoint, RdcLifecycleReceipt } from '../../rdc/RdcLifecycleReceipts';
import type { EffectiveRuntimePlan } from '../EffectiveRuntimePlan';

const cli = {
  enabled: true,
  command: 'rdc',
  argsPrefix: [],
  workingDirectory: '',
  env: {},
  noProgressTimeoutMs: 300_000,
};
function point(inputId: string, eventId: number): RdcLifecyclePoint {
  const n = inputId === 'a' ? 1 : 2;
  return {
    inputId,
    contentSha256: inputId.repeat(64),
    deviceId: 'device',
    target: { textureId: 'target', outputSlot: 0 },
    isFinalOutput: false,
    native: {
      contextId: `context-${inputId}`,
      leaseVersion: n,
      replaySessionId: `replay-${inputId}`,
      captureFileId: `file-${inputId}`,
      eventId,
      replacementCount: 0,
      replacementFingerprint: '0'.repeat(64),
      processIdentity: {
        status: 'available' as const,
        daemon: { pid: n * 10, start_generation: 'windows-filetime:1' },
        worker: { pid: n * 10 + 1, start_generation: 'windows-filetime:2' },
      },
    },
  };
}
function fixture() {
  const turn = new TurnHandle({ sessionKey: 's', turnId: 't', generation: 1 });
  turn.runtimePlan = { fingerprint: '1'.repeat(24) } as EffectiveRuntimePlan;
  turn.promptPlan = { systemPrompt: 'prompt' } as PromptPlan;
  const firstBinding = freezeRdcTurnBinding(cli, [], null);
  bindRdcTurn(turn.runtimePlan, firstBinding);
  let current: RdcLifecyclePoint | null = point('a', 42);
  let quarantined: { contextId: string; leaseVersion: number } | null = null;
  let sequence = 1;
  const receipts: RdcLifecycleReceipt[] = [];
  const host: ApprovedCaptureHost = {
    assertPlan: vi.fn(),
    pendingRecord: vi.fn(() => null),
    quarantinedContext: vi.fn(() => quarantined),
    prepareReceipts: vi.fn(),
    quiescent: vi.fn(async () => {}),
    snapshot: vi.fn(async () => (current ? structuredClone(current) : null)),
    verifyDestination: vi.fn(async () => {}),
    open: vi.fn(async (destination, _binding, _signal, onStopped) => {
      if (current) onStopped(current.native.contextId);
      current = point(destination.inputId, 9);
    }),
    close: vi.fn(async (_binding, _signal, onStopped) => {
      if (current) onStopped(current.native.contextId);
      current = null;
    }),
    restorePosition: vi.fn(async (original) => {
      // Moving the position keeps the replay's own native identity.
      current = current
        ? { ...structuredClone(original), native: { ...current.native, eventId: original.native.eventId } }
        : structuredClone(original);
    }),
    recoveryGuard: vi.fn(() => () => {}),
    joinRecoveryChild: vi.fn(async () => {}),
    inspectRecovery: vi.fn(async (original) => ({
      cause: { operation: 'rd.test', argsFingerprint: 'e'.repeat(64), code: 'native_failure' },
      observed: {
        source: 'daemon' as const,
        daemon: { state: 'alive' as const, ...original.native.processIdentity.daemon },
        worker: { state: 'alive' as const, ...original.native.processIdentity.worker },
        replaySession: { isLive: true, requiresRestart: false, workerExit: null },
      },
      classification: { decision: 'keep' as const, reason: 'verified-processes-live' as const },
    })) as ApprovedCaptureHost['inspectRecovery'],
    reopenAfterFailure: vi.fn(async (destination, _binding, _signal, onStopped) => {
      if (current) onStopped(current.native.contextId);
      quarantined = null;
      current = point(destination.inputId, 9);
      current.native.contextId += '-reopened';
      current.native.leaseVersion += 10;
      current.native.replaySessionId += '-reopened';
      current.native.captureFileId += '-reopened';
    }),
    reprepare: vi.fn(async (previous) => {
      const plan = { ...previous.plan, fingerprint: String(++sequence).repeat(24) } as EffectiveRuntimePlan;
      const binding = freezeRdcTurnBinding(cli, [], null);
      bindRdcTurn(plan, binding);
      return { plan, prompt: previous.prompt, binding };
    }),
    appendEpoch: vi.fn(async () => {}),
    writeReceipt: vi.fn((receipt) => {
      receipts.push(receipt);
      return { uri: `session://tool-outputs/${receipts.length}.json`, expectedHash: `sha256:${'a'.repeat(64)}` };
    }),
    quarantineChanged: vi.fn(),
  };
  const controller = new ApprovedCaptureController({
    sessionId: 's',
    projectId: 'p',
    planUri: 'session://plans/p.md',
    planHash: 'f'.repeat(64),
    captureScope: {
      projectId: 'p',
      deviceId: 'device',
      comparisonGoal: 'compare',
      inputs: [
        { inputId: 'a', fileName: 'a.rdc', contentSha256: 'a'.repeat(64) },
        { inputId: 'b', fileName: 'b.rdc', contentSha256: 'b'.repeat(64) },
      ],
    },
    turn,
    host,
  });
  return {
    controller,
    turn,
    host,
    receipts,
    setCurrent: (value: RdcLifecyclePoint | null) => {
      current = value;
    },
    quarantine: (value: { contextId: string; leaseVersion: number } | null) => {
      quarantined = value;
    },
  };
}

it('switches only approved captures, records epochs, and restores the original event and target', async () => {
  const f = fixture();
  await f.controller.initialize();
  await expect(f.controller.select('unapproved')).rejects.toThrow('RDC_CAPTURE_NOT_APPROVED');
  expect(f.host.open).not.toHaveBeenCalled();
  expect(await f.controller.select('b')).toMatchObject({ changed: true, current: { inputId: 'b' } });
  expect(f.turn.runtimeEpochs).toHaveLength(1);
  expect(f.receipts.map((value) => value.event)).toEqual(['baseline', 'intent', 'daemon-stopped', 'transition']);
  expect(await f.controller.restore()).toMatchObject({ changed: true });
  expect(f.host.restorePosition).toHaveBeenCalledWith(
    expect.objectContaining({ inputId: 'a', native: expect.objectContaining({ eventId: 42 }) }),
    expect.anything(),
    undefined,
  );
  expect(f.turn.runtimeEpochs).toHaveLength(2);
  expect(f.receipts.at(-1)).toMatchObject({
    event: 'transition',
    restored: true,
    to: { inputId: 'a', native: { eventId: 42 } },
  });
  expect(await f.controller.restore()).toEqual({ changed: false });
  expect(await f.controller.recordTerminalRestoration()).toBe(true);
  expect(f.receipts.at(-1)).toMatchObject({ event: 'resolved', observed: { inputId: 'a', native: { eventId: 42 } } });
});

it('refuses active replacements and suppresses a repeated failed transition without refreshing budgets', async () => {
  const f = fixture();
  await f.controller.initialize();
  const changed = point('a', 42);
  changed.native.replacementCount = 1;
  f.setCurrent(changed);
  await expect(f.controller.select('b')).rejects.toThrow('RDC_SWITCH_REPLACEMENTS_ACTIVE');
  expect(f.host.open).not.toHaveBeenCalled();
  f.setCurrent(point('a', 42));
  vi.mocked(f.host.open).mockRejectedValueOnce(new Error('RDC_OPEN_FAILED: native replay failed'));
  await expect(f.controller.select('b')).rejects.toThrow('RDC_OPEN_FAILED');
  await expect(f.controller.select('b')).rejects.toThrow('RDC_SWITCH_REPEATED_FAILURE');
  expect(f.host.open).toHaveBeenCalledTimes(1);
  expect(f.receipts.at(-1)).toMatchObject({ event: 'failed', code: 'RDC_OPEN_FAILED' });
  expect(f.turn.runtimeEpochs).toHaveLength(0);
});

it('restores position without inventing a new runtime epoch when the capture did not change', async () => {
  const f = fixture();
  await f.controller.initialize();
  f.setCurrent(point('a', 7));
  expect(await f.controller.restore()).toMatchObject({ changed: true });
  expect(f.turn.runtimeEpochs).toHaveLength(0);
  expect(f.receipts.at(-1)).toMatchObject({ event: 'position-restored', to: { native: { eventId: 42 } } });
});

it('restores an entry with no target by reopening and verifying the same approved capture', async () => {
  const f = fixture();
  const original = point('a', 42);
  original.target = null;
  f.setCurrent(original);
  await f.controller.initialize();
  f.setCurrent(point('a', 7));
  const budget = f.turn.policyBudget;
  vi.mocked(f.host.open).mockImplementationOnce(async (_destination, _binding, _signal, onStopped) => {
    onStopped('context-a');
    const reopened = structuredClone(original);
    reopened.native.contextId = 'context-reopened';
    reopened.native.leaseVersion = 2;
    reopened.native.replaySessionId = 'replay-reopened';
    reopened.native.captureFileId = 'file-reopened';
    f.setCurrent(reopened);
  });
  expect(await f.controller.restore()).toMatchObject({ changed: true });
  expect(f.host.verifyDestination).toHaveBeenCalledWith({
    inputId: 'a',
    contentSha256: 'a'.repeat(64),
    deviceId: 'device',
  });
  expect(f.host.restorePosition).not.toHaveBeenCalled();
  expect(f.turn.policyBudget).toBe(budget);
  expect(f.turn.runtimeEpochs).toHaveLength(1);
  expect(f.receipts.at(-1)).toMatchObject({
    event: 'transition',
    restored: true,
    to: { target: null, native: { contextId: 'context-reopened', eventId: 42 } },
  });
  expect(await f.controller.recordTerminalRestoration()).toBe(true);
});

it('does not claim a reopened empty-target entry was restored if its observed position differs', async () => {
  const f = fixture();
  const original = point('a', 42);
  original.target = null;
  f.setCurrent(original);
  await f.controller.initialize();
  f.setCurrent(point('a', 7));
  vi.mocked(f.host.open).mockImplementationOnce(async (_destination, _binding, _signal, onStopped) => {
    onStopped('context-a');
    const reopened = point('a', 9);
    reopened.native.contextId = 'context-reopened';
    f.setCurrent(reopened);
  });
  vi.mocked(f.host.restorePosition).mockResolvedValueOnce();
  await expect(f.controller.restore()).rejects.toThrow('RDC_RESTORE_UNCONFIRMED');
  expect(f.receipts.at(-1)).toMatchObject({ event: 'failed', code: 'RDC_RESTORE_UNCONFIRMED' });
  expect(f.host.quarantineChanged).toHaveBeenCalled();
});

it('exposes an immutable signed baseline only to the owning full-access General turn', async () => {
  const f = fixture();
  const owner = { sessionId: 's', projectId: 'p', turnId: 't', agentId: 'general', accessCeiling: 'full' } as const;
  expect(f.controller.restorationBaselineFor(owner)).toEqual({
    available: false,
    reason: 'RDC_INITIAL_STATE_UNVERIFIED',
  });
  await f.controller.initialize();
  const baseline = f.controller.restorationBaselineFor(owner);
  expect(baseline).toMatchObject({
    available: true,
    original: { inputId: 'a', native: { eventId: 42 } },
    receipt: { uri: 'session://tool-outputs/1.json', expectedHash: `sha256:${'a'.repeat(64)}` },
  });
  if (baseline?.available && baseline.original) baseline.original.native.eventId = 11;
  await f.controller.select('b');
  expect(f.controller.restorationBaselineFor(owner)).toMatchObject({
    available: true,
    original: { native: { eventId: 42 } },
  });
  for (const foreign of [
    { sessionId: 'foreign' },
    { projectId: 'foreign' },
    { turnId: 'foreign' },
    { agentId: 'analyzer' },
    { accessCeiling: 'read-only' },
  ] as const) {
    expect(f.controller.restorationBaselineFor({ ...owner, ...foreign })).toBeNull();
  }
});

it('distinguishes a verified empty baseline from an initialization failure', async () => {
  const owner = { sessionId: 's', projectId: 'p', turnId: 't', agentId: 'general', accessCeiling: 'full' } as const;
  const empty = fixture();
  empty.setCurrent(null);
  await empty.controller.initialize();
  expect(empty.controller.restorationBaselineFor(owner)).toMatchObject({
    available: true,
    original: null,
    receipt: { uri: expect.any(String) },
  });
  const failed = fixture();
  vi.mocked(failed.host.prepareReceipts).mockImplementationOnce(() => {
    throw new Error('signing failed');
  });
  await failed.controller.initialize();
  expect(failed.controller.restorationBaselineFor(owner)).toEqual({
    available: false,
    reason: 'RDC_INITIAL_STATE_UNVERIFIED',
  });
});

it('reports the live observed position against the frozen baseline without changing it', async () => {
  const f = fixture();
  await f.controller.initialize();
  f.setCurrent(point('a', 11));
  expect(await f.controller.restorationStatus()).toMatchObject({
    restored: false,
    original: { native: { eventId: 42 } },
    current: { native: { eventId: 11 } },
    receipt: { uri: 'session://tool-outputs/1.json' },
  });
  await f.controller.restore();
  expect(await f.controller.restorationStatus()).toMatchObject({
    restored: true,
    original: { native: { eventId: 42 } },
    current: { native: { eventId: 42 } },
  });
});

it('records a same-input recovery epoch with the signed admission decision', async () => {
  const f = fixture();
  await f.controller.initialize();
  await f.controller.prepareRecovery(1);
  const recovered = await f.controller.recover();
  expect(recovered.current).toMatchObject({
    inputId: 'a',
    deviceId: 'device',
    native: { contextId: 'context-a-reopened' },
  });
  expect(f.receipts).toMatchObject([
    { event: 'baseline', original: { inputId: 'a' } },
    {
      event: 'intent',
      recovery: { cause: { operation: 'rd.test', code: 'native_failure' }, observed: { daemon: { pid: 10 } } },
    },
    { event: 'daemon-stopped', contextId: 'context-a' },
    { event: 'transition', restored: false, from: { inputId: 'a' }, to: { inputId: 'a' } },
  ]);
  expect(f.receipts[1]).toMatchObject({ recovery: { classification: { decision: 'keep' } } });
  expect(f.turn.runtimeEpochs).toHaveLength(1);
});

it('verifies the entry position after recovery without claiming a terminal receipt early', async () => {
  const f = fixture();
  await f.controller.initialize();
  await f.controller.prepareRecovery(1);
  const recovered = await f.controller.recover();
  const returned = structuredClone(recovered.current);
  returned.native.eventId = 42;
  f.setCurrent(returned);
  expect(await f.controller.restore()).toEqual({ changed: false });
  expect(await f.controller.restorationStatus()).toMatchObject({
    restored: true,
    original: { native: { contextId: 'context-a', eventId: 42 } },
    current: { native: { contextId: 'context-a-reopened', eventId: 42 } },
    receipt: { uri: 'session://tool-outputs/1.json' },
  });
  expect(f.receipts.some((receipt) => receipt.event === 'resolved')).toBe(false);
  expect(await f.controller.recordTerminalRestoration()).toBe(true);
  expect(f.receipts.at(-1)).toMatchObject({
    event: 'resolved',
    observed: { native: { contextId: 'context-a-reopened' } },
  });
});

it('does not reopen when the permission or verification guard fails', async () => {
  const f = fixture();
  await f.controller.initialize();
  vi.mocked(f.host.inspectRecovery).mockRejectedValueOnce(new Error('RDC_RECOVERY_IDENTITY_UNVERIFIED'));
  await f.controller.prepareRecovery(1);
  await expect(f.controller.recover()).rejects.toThrow('RDC_RECOVERY_IDENTITY_UNVERIFIED');
  expect(f.host.reopenAfterFailure).not.toHaveBeenCalled();
  vi.mocked(f.host.recoveryGuard).mockReturnValueOnce(() => {
    throw new Error('RDC_RECOVERY_PERMISSION_CHANGED');
  });
  await expect(f.controller.prepareRecovery(1)).rejects.toThrow('RDC_RECOVERY_PERMISSION_CHANGED');
  expect(f.receipts.map((value) => value.event)).toEqual(['baseline']);
});

it('blocks live RDC access if an earlier saved position remains unresolved', async () => {
  const f = fixture();
  vi.mocked(f.host.pendingRecord).mockReturnValue(pendingRecord('session://plans/other.md'));
  await f.controller.initialize();
  expect(() => f.controller.assertLiveAccess()).toThrow('RDC_PREVIOUS_RESTORE_REQUIRED');
  expect(f.host.snapshot).not.toHaveBeenCalled();
  expect(f.receipts).toHaveLength(0);
});

function pendingRecord(planUri = 'session://plans/p.md') {
  const original = point('a', 42);
  return {
    baseline: {
      event: 'baseline' as const,
      sessionId: 's',
      projectId: 'p',
      turnId: 'earlier-turn',
      operationId: 'op',
      planUri,
      planHash: 'f'.repeat(64),
      recordedAt: 1,
      original,
    },
    ref: { uri: 'session://tool-outputs/earlier.json', expectedHash: `sha256:${'b'.repeat(64)}` },
    count: 1,
    identities: [],
    latest: point('a', 7),
  };
}

it('lets a quarantined lease recover first, then restores the entry position on the new lease', async () => {
  const f = fixture();
  await f.controller.initialize();
  f.quarantine({ contextId: 'context-a', leaseVersion: 1 });
  await expect(f.controller.restore()).rejects.toThrow('RDC_CONTEXT_QUARANTINED');
  expect(() => f.controller.assertLiveAccess()).toThrow('RDC_CONTEXT_QUARANTINED');
  expect(() => f.controller.assertLiveAccess(true)).not.toThrow();
  await f.controller.prepareRecovery(1);
  await f.controller.recover();
  expect(await f.controller.restore()).toMatchObject({ changed: true });
  const [restored, binding] = vi.mocked(f.host.restorePosition).mock.calls.at(-1)!;
  expect(restored.native.eventId).toBe(42);
  expect(binding).toBe(getRdcTurnBinding(f.turn.runtimePlan!));
  expect(f.receipts.at(-1)).toMatchObject({
    event: 'position-restored',
    from: { native: { contextId: 'context-a-reopened' } },
  });
});

it('continues an earlier unresolved chain when a new turn meets its quarantined lease', async () => {
  const f = fixture();
  f.quarantine({ contextId: 'context-a', leaseVersion: 1 });
  vi.mocked(f.host.pendingRecord).mockReturnValue(pendingRecord());
  await f.controller.initialize();
  expect(f.host.snapshot).not.toHaveBeenCalled();
  expect(() => f.controller.assertLiveAccess()).toThrow('RDC_CONTEXT_QUARANTINED');
  const owner = { sessionId: 's', projectId: 'p', turnId: 't', agentId: 'general', accessCeiling: 'full' } as const;
  expect(f.controller.restorationBaselineFor(owner)).toMatchObject({
    available: true,
    original: { native: { eventId: 42 } },
    receipt: { uri: 'session://tool-outputs/earlier.json' },
  });
  await f.controller.prepareRecovery(1);
  await f.controller.recover();
  expect(f.host.inspectRecovery).toHaveBeenCalledWith(
    expect.objectContaining({ native: expect.objectContaining({ contextId: 'context-a', eventId: 7 }) }),
    expect.anything(),
    undefined,
  );
  expect(f.receipts.map((value) => [value.event, value.turnId])).toEqual([
    ['intent', 't'],
    ['daemon-stopped', 't'],
    ['transition', 't'],
  ]);
  expect(() => f.controller.assertLiveAccess()).not.toThrow();
  await f.controller.restore();
  expect(await f.controller.recordTerminalRestoration()).toBe(true);
  expect(f.receipts.at(-1)).toMatchObject({
    event: 'resolved',
    turnId: 'earlier-turn',
    baseline: { uri: 'session://tool-outputs/earlier.json' },
  });
});

it('recovers from the latest process identity a successful result reported, not the turn-start snapshot', async () => {
  const f = fixture();
  await f.controller.initialize();
  const reported = {
    status: 'available' as const,
    daemon: { pid: 10, start_generation: 'windows-filetime:1' },
    worker: { pid: 12, start_generation: 'windows-filetime:3' },
  };
  noteRdcProcessIdentity('context-a', reported);
  await f.controller.prepareRecovery(1);
  await f.controller.recover();
  expect(f.host.inspectRecovery).toHaveBeenCalledWith(
    expect.objectContaining({ native: expect.objectContaining({ processIdentity: reported }) }),
    expect.anything(),
    undefined,
  );
  expect(f.receipts.find((receipt) => receipt.event === 'intent')).toMatchObject({
    from: { native: { processIdentity: reported } },
  });
});

it('signs an unexplained process change as a failed recovery attempt without reopening', async () => {
  const f = fixture();
  await f.controller.initialize();
  vi.mocked(f.host.inspectRecovery).mockResolvedValueOnce({
    cause: { operation: 'rd.test', argsFingerprint: 'e'.repeat(64), code: 'worker_stuck' },
    observed: {
      source: 'daemon',
      daemon: { state: 'alive', pid: 10, start_generation: 'windows-filetime:1' },
      worker: { state: 'alive', pid: 99, start_generation: 'windows-filetime:9' },
      replaySession: { isLive: false, requiresRestart: true, workerExit: null },
    },
    classification: {
      decision: 'quarantined',
      code: 'RDC_RECOVERY_PROCESS_UNEXPLAINED',
      reason: 'a worker change has no confirmed exit receipt of the verified worker.',
    },
  });
  await f.controller.prepareRecovery(1);
  await expect(f.controller.recover()).rejects.toThrow('RDC_RECOVERY_PROCESS_UNEXPLAINED');
  expect(f.host.reopenAfterFailure).not.toHaveBeenCalled();
  expect(f.receipts.map((value) => value.event)).toEqual(['baseline', 'intent', 'failed']);
  expect(f.receipts[1]).toMatchObject({ recovery: { classification: { decision: 'quarantined' } } });
  expect(f.receipts[2]).toMatchObject({ code: 'RDC_RECOVERY_PROCESS_UNEXPLAINED' });
  expect(f.host.quarantineChanged).toHaveBeenCalled();
});

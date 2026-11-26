import { expect, it } from 'vitest';
import { assertTurnRuntimeEpochs } from './TurnRuntimeEpochs';
import type { ExecutionOffer } from '../sessions/run/executionOffer';
import type { RdcLifecycleReceipt } from '../rdc/RdcLifecycleReceipts';

it('accepts only a linked, signed transition for the same approved plan and owning turn', () => {
  const ref = (id: string) => ({ uri: `session://tool-outputs/${id}.json`, expectedHash: `sha256:${'a'.repeat(64)}` });
  const offer: ExecutionOffer = {
    sourceAgentId: 'analyzer',
    targetAgentId: 'general',
    plan: { uri: 'session://plans/plan.md', hash: 'b'.repeat(64) },
    requiredSkillIds: [],
    label: 'Go',
    prompt: 'Go',
    approvedAt: 1,
  };
  const base = {
    sessionId: 's',
    projectId: 'p',
    turnId: 't',
    operationId: 'op',
    planUri: offer.plan.uri,
    planHash: offer.plan.hash,
    recordedAt: 10,
  };
  const native = {
    contextId: 'old',
    leaseVersion: 1,
    replaySessionId: 'replay',
    captureFileId: 'file',
    eventId: 3,
    processIdentity: {
      status: 'available' as const,
      daemon: { pid: 1, start_generation: 'windows-filetime:1' },
      worker: { pid: 2, start_generation: 'windows-filetime:2' },
    },
    replacementCount: 0,
    replacementFingerprint: 'c'.repeat(64),
  };
  const point = {
    inputId: 'a',
    contentSha256: 'd'.repeat(64),
    deviceId: 'device',
    native,
    target: null,
    isFinalOutput: false,
  };
  const records: Record<string, RdcLifecycleReceipt> = {
    intent: { ...base, event: 'intent', original: null, from: point, destination: null },
    stopped: { ...base, event: 'daemon-stopped', intent: ref('intent'), contextId: 'old', stopped: true },
    transition: {
      ...base,
      event: 'transition',
      intent: ref('intent'),
      from: point,
      to: null,
      previousFingerprint: '1'.repeat(24),
      runtimeFingerprint: '2'.repeat(24),
      daemonStopped: ref('stopped'),
      restored: true,
    },
  };
  const receipt = {
    turnId: 't',
    initialRuntimePlanFingerprint: '1'.repeat(24),
    runtimePlanFingerprint: '2'.repeat(24),
    runtimeEpochs: [
      {
        previousFingerprint: '1'.repeat(24),
        runtimeFingerprint: '2'.repeat(24),
        receipt: ref('transition'),
        recordedAt: 10,
      },
    ],
    finalAnswerText: 'done',
  };
  const input = {
    sessionId: 's',
    turnId: 't',
    initialFingerprint: '1'.repeat(24),
    offer,
    receipt,
    read: (_session: string, r: { uri: string }) => records[r.uri.split('/').at(-1)!.replace('.json', '')]!,
  };
  expect(() => assertTurnRuntimeEpochs(input)).not.toThrow();
  records.stopped = { ...records.stopped, contextId: 'other' } as RdcLifecycleReceipt;
  expect(() => assertTurnRuntimeEpochs(input)).toThrow('daemon stop receipt');
  records.stopped = { ...base, event: 'daemon-stopped', intent: ref('intent'), contextId: 'old', stopped: true };
  expect(() =>
    assertTurnRuntimeEpochs({ ...input, offer: { ...offer, plan: { ...offer.plan, hash: 'e'.repeat(64) } } }),
  ).toThrow('approved turn');
  expect(() =>
    assertTurnRuntimeEpochs({ ...input, receipt: { ...receipt, runtimePlanFingerprint: '3'.repeat(24) } }),
  ).toThrow('final runtime identity');
  expect(() => assertTurnRuntimeEpochs({ ...input, offer: null })).toThrow('invalid runtime epoch');
});

it('requires a recovery to retain the input and the last verified daemon and worker identity', () => {
  const ref = (id: string) => ({ uri: `session://tool-outputs/${id}.json`, expectedHash: `sha256:${'a'.repeat(64)}` });
  const offer: ExecutionOffer = {
    sourceAgentId: 'analyzer',
    targetAgentId: 'general',
    plan: { uri: 'session://plans/plan.md', hash: 'b'.repeat(64) },
    requiredSkillIds: [],
    label: 'Go',
    prompt: 'Go',
    approvedAt: 1,
  };
  const base = {
    sessionId: 's',
    projectId: 'p',
    turnId: 't',
    operationId: 'op',
    planUri: offer.plan.uri,
    planHash: offer.plan.hash,
    recordedAt: 10,
  };
  const native = {
    contextId: 'old',
    leaseVersion: 1,
    replaySessionId: 'replay',
    captureFileId: 'file',
    eventId: 3,
    processIdentity: {
      status: 'available' as const,
      daemon: { pid: 1, start_generation: 'windows-filetime:1' },
      worker: { pid: 2, start_generation: 'windows-filetime:2' },
    },
    replacementCount: 0,
    replacementFingerprint: 'c'.repeat(64),
  };
  const from = {
    inputId: 'a',
    contentSha256: 'd'.repeat(64),
    deviceId: 'device',
    native,
    target: null,
    isFinalOutput: false,
  };
  const to = { ...from, native: { ...native, contextId: 'new', replaySessionId: 'new-replay', leaseVersion: 2 } };
  const records: Record<string, RdcLifecycleReceipt> = {
    intent: {
      ...base,
      event: 'intent',
      original: from,
      from,
      destination: { inputId: 'a', contentSha256: 'd'.repeat(64), deviceId: 'device' },
      recovery: {
        cause: { operation: 'rd.test', argsFingerprint: 'e'.repeat(64), code: 'failure' },
        observed: {
          source: 'daemon',
          daemon: { state: 'alive', pid: 1, start_generation: 'windows-filetime:1' },
          worker: { state: 'alive', pid: 2, start_generation: 'windows-filetime:2' },
          replaySession: { isLive: true, requiresRestart: false, workerExit: null },
        },
        classification: { decision: 'keep', reason: 'verified-processes-live' },
      },
    },
    stopped: { ...base, event: 'daemon-stopped', intent: ref('intent'), contextId: 'old', stopped: true },
    transition: {
      ...base,
      event: 'transition',
      intent: ref('intent'),
      from,
      to,
      previousFingerprint: '1'.repeat(24),
      runtimeFingerprint: '2'.repeat(24),
      daemonStopped: ref('stopped'),
      restored: false,
    },
  };
  const receipt = {
    turnId: 't',
    initialRuntimePlanFingerprint: '1'.repeat(24),
    runtimePlanFingerprint: '2'.repeat(24),
    runtimeEpochs: [
      {
        previousFingerprint: '1'.repeat(24),
        runtimeFingerprint: '2'.repeat(24),
        receipt: ref('transition'),
        recordedAt: 10,
      },
    ],
    finalAnswerText: 'done',
  };
  const input = {
    sessionId: 's',
    turnId: 't',
    initialFingerprint: '1'.repeat(24),
    offer,
    receipt,
    read: (_session: string, r: { uri: string }) => records[r.uri.split('/').at(-1)!.replace('.json', '')]!,
  };
  expect(() => assertTurnRuntimeEpochs(input)).not.toThrow();
  const intent = records.intent;
  if (intent.event !== 'intent' || !intent.recovery) throw new Error('fixture');
  intent.recovery.observed.daemon = { state: 'alive', pid: 3, start_generation: 'windows-filetime:3' };
  expect(() => assertTurnRuntimeEpochs(input)).toThrow('recovery lacks same-input and process continuity');
});

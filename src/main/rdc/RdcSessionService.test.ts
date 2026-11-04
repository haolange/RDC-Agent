import { clearRdcContextLeases, setRdcRuntimeContextForSession, quarantineRdcContext } from './RdcRuntimeContextRegistry';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenProjectInputRequest } from '@shared/types/session';
import type { ReplayDeviceSnapshot } from '@shared/types/device';
const mocks = vi.hoisted(() => ({ deviceSubscribers: new Set<(snapshot: ReplayDeviceSnapshot) => void>(), identity: vi.fn(), inspect: vi.fn(), prepare: vi.fn(), close: vi.fn(), observe: vi.fn(), events: vi.fn(), append: vi.fn(), hash: vi.fn(), saveSelection: vi.fn(), liveRead: vi.fn(), liveClear: vi.fn(), project: vi.fn(), reference: vi.fn() }));
vi.mock('./captures/replay/captureContentHash', () => ({ hashCaptureFile: mocks.hash }));
vi.mock('../sessions/store/StorageAdapter', () => ({ storageAdapter: { getProjectById: mocks.project } }));
vi.mock('./captures/ExternalCaptureReference', () => ({ verifyExternalCaptureReference: mocks.reference }));
vi.mock('./captures/replay/ReplayHistoryStore', () => ({ replayHistoryStore: { saveSelection: mocks.saveSelection, append: mocks.append } }));
vi.mock('./captures/replay/ReplayLivePreviewStore', () => ({
  replayLivePreviewStore: { read: mocks.liveRead, clear: mocks.liveClear, write: vi.fn() },
}));
vi.mock('../tools/ShellInvocationService', () => ({ shellInvocationService: { hasUnconfirmedProcesses: () => false } }));
vi.mock('./OwnedRdcDaemonRegistry', () => ({ harvestOwnedRdcDaemons: vi.fn(async () => ({ released: [], failed: [] })) }));
vi.mock('./RdcReplayObservation', () => ({ observeReplay: mocks.observe, readReplayEvents: mocks.events }));
vi.mock('./captures/ReplayDeviceService', () => ({ replayDeviceService: {
  subscribe: (listener: (snapshot: ReplayDeviceSnapshot) => void) => { mocks.deviceSubscribers.add(listener); return () => mocks.deviceSubscribers.delete(listener); },
  getDeviceById: (id: string) => ({ id, label: id, type: id === 'local' ? 'local' : 'android', status: 'online', transport: id === 'local' ? 'local' : 'adb_android', adbState: 'device', serial: 'SERIAL' }),
} }));
vi.mock('./RdcRemoteConnection', () => ({ configuredRemotePreparationIdentity: mocks.identity }));
vi.mock('./RdcSessionRuntime', () => ({ RdcSessionRuntime: class {
  opened: Record<string, unknown> | null = null;
  contextId: string | null = null; deviceId: string | null = null;
  async prepareReplayDevice(scope: {sessionId:string}, device: {id:string}, options?: {signal?:AbortSignal}) { this.contextId = 'context-' + scope.sessionId; this.deviceId = device.id; await mocks.prepare(scope, device, options); options?.signal?.throwIfAborted(); }
  async inspectReplayDeviceInstallation(scope: {sessionId:string}, device: {id:string}, options: unknown) { this.contextId = 'context-' + scope.sessionId; this.deviceId = device.id; return mocks.inspect(scope, device, options); }
  isPreparedFor(_scope: unknown, deviceId: string) { return this.deviceId === deviceId; }
  async openProjectInput(request: OpenProjectInputRequest) {
    this.contextId = 'context-' + request.sessionId; this.deviceId = request.replayDevice.id;
    this.opened = { ...request, ownerSessionId: request.sessionId, contextId: `context-${request.sessionId}`,
      runtimeContext: { contextId: `context-${request.sessionId}`, replaySessionId: `native-${request.sessionId}` } };
    return this.opened;
  }
  getPreparationBindingIdentity() { return 'binding-old'; }
  getCliSettings() { return undefined; }
  getContextId() { return this.contextId; }
  snapshotOpenedCaptureForSession() { return this.opened; }
  snapshotContextForSession() { return this.opened; }
  async clearOpenedCaptureForSession() { if (!this.contextId) return false; await mocks.close(); this.opened = null; this.contextId = null; this.deviceId = null; return true; }
} }));
import { harvestOwnedRdcDaemons } from './OwnedRdcDaemonRegistry';
import { RdcSessionService } from './RdcSessionService';
import { parseRdcNativeResult, RdcNativeFailure } from './RdcNativeProtocol';
import { setRdcInteractionLock, runRdcOperation } from './RdcOperationCoordinator';
const scope = { projectId: 'p', sessionId: 's1' };
const request = (sessionId = 's1', remote = false): OpenProjectInputRequest => ({ projectId: 'p', sessionId,
  inputId: 'capture', filePath: '/project/capture.rdc', replayDevice: { id: remote ? 'android' : 'local',
    type: remote ? 'android' : 'local', label: 'device', status: 'online', transport: 'local' } });
async function openRemote(service: RdcSessionService, sessionId = 's1') {
  const value = request(sessionId, true);
  await service.prepareDevice({projectId:value.projectId,sessionId,deviceId:value.replayDevice.id,bindingGeneration:service.snapshotReplayForSession(value).generation});
  return service.openProjectInput(value);
}
beforeEach(() => { clearRdcContextLeases(); vi.clearAllMocks(); mocks.project.mockReturnValue({ rootPath: '/project' }); mocks.reference.mockReset(); mocks.hash.mockReset(); mocks.hash.mockResolvedValue({ sha256: 'a'.repeat(64) }); mocks.close.mockResolvedValue(undefined); mocks.prepare.mockReset(); mocks.prepare.mockResolvedValue(undefined); mocks.identity.mockResolvedValue('binding-old');
  mocks.deviceSubscribers.clear();
  mocks.inspect.mockReset(); mocks.inspect.mockResolvedValue({ state: 'pending', deviceSerial: 'SERIAL', packageName: 'helper', apkSha256: 'a'.repeat(64) });
  mocks.events.mockResolvedValue([{ eventId: 1 }, { eventId: 9 }]);
  mocks.observe.mockResolvedValue({ appliedEventId: 9, imageEventId: 9, error: null });
  mocks.liveRead.mockResolvedValue(Buffer.from('png'));
  setRdcInteractionLock('s1', 'test', false);
});
describe('per-session capture lifecycle', () => {
  it('rejects a changed external source before opening native replay', async () => {
    mocks.project.mockReturnValue({ rootPath: '/project', inputs: [{ inputId: 'capture', filePath: '/project/capture.rdc', source: 'external_reference' }] });
    mocks.reference.mockRejectedValue(new Error('CAPTURE_REFERENCE_CHANGED'));
    const service = new RdcSessionService();
    await expect(service.openProjectInput(request())).rejects.toThrow('CAPTURE_REFERENCE_CHANGED');
    expect(service.snapshotOpenedCaptureForSession(scope)).toBeNull();
    expect(mocks.saveSelection).not.toHaveBeenCalled();
  });
  it('closes replay if external identity changes during open, even with equal bytes', async () => {
    mocks.project.mockReturnValue({ rootPath: '/project', inputs: [{ inputId: 'capture', filePath: '/project/capture.rdc', source: 'external_reference' }] });
    mocks.reference.mockResolvedValueOnce({ contentSha256: 'a'.repeat(64) }).mockRejectedValueOnce(new Error('CAPTURE_REFERENCE_CHANGED'));
    const service = new RdcSessionService();
    await expect(service.openProjectInput(request())).rejects.toThrow('CAPTURE_REFERENCE_CHANGED');
    expect(mocks.close).toHaveBeenCalledTimes(1);
    expect(service.snapshotOpenedCaptureForSession(scope)).toBeNull();
    expect(mocks.events).not.toHaveBeenCalled();
  });
  it('keeps same capture independent across sessions', async () => {
    const service = new RdcSessionService(); await service.openProjectInput(request()); await service.openProjectInput(request('s2'));
    expect(mocks.close).not.toHaveBeenCalled();
    expect(service.snapshotOpenedCaptureForSession(scope)?.contextId).toBe('context-s1');
    await service.clearOpenedCaptureForSession(scope);
    expect(service.snapshotOpenedCaptureForSession({ ...scope, sessionId: 's2' })?.contextId).toBe('context-s2');
  });
  it('retains remote device reservation on close failure', async () => {
    const service = new RdcSessionService(); await openRemote(service);
    mocks.close.mockRejectedValueOnce(new Error('close uncertain'));
    await expect(service.clearOpenedCaptureForSession(scope)).rejects.toThrow('uncertain');
    await expect(openRemote(service, 's2')).rejects.toThrow('DEVICE_IN_USE');
    expect(service.snapshotOpenedCaptureForSession(scope)).not.toBeNull();
  });
  it('publishes real stages and final-output observation', async () => {
    const service = new RdcSessionService(); const phases: string[] = []; service.subscribe(state => phases.push(state.phase));
    await service.openProjectInput(request());
    expect(phases).toContain('validating'); expect(phases).toContain('loading_image');
    expect(mocks.observe).toHaveBeenCalledWith(expect.anything(), { final_output: true }, undefined, expect.objectContaining({ sessionId: 's1' }));
    expect(service.snapshotReplayForSession(scope).phase).toBe('ready');
  });
  it('retains opened context when image loading fails', async () => {
    mocks.observe.mockRejectedValueOnce(new Error('image unavailable'));
    const service = new RdcSessionService(); await service.openProjectInput(request());
    expect(service.snapshotOpenedCaptureForSession(scope)).not.toBeNull();
    expect(service.snapshotReplayForSession(scope).error?.retry).toBe('image');
  });
  it('locks UI throughout Agent preparation and broadcasts lock changes', async () => {
    const service = new RdcSessionService(); await service.openProjectInput(request());
    const listener = vi.fn(); service.subscribe(listener); setRdcInteractionLock('s1', 'test', true);
    expect(listener.mock.lastCall?.[0].interactionLock).toBe('agent_running');
    await expect(service.clearOpenedCaptureForSession(scope)).rejects.toThrow('LOCKED');
    await expect(service.applyEventForSession({ ...scope, bindingGeneration: 1, eventId: 1 })).rejects.toThrow('LOCKED');
    setRdcInteractionLock('s1', 'test', false);
    await service.clearOpenedCaptureForSession(scope);
  });
  it('does not execute invalid EIDs or stale slider requests', async () => {
    const service = new RdcSessionService(); await service.openProjectInput(request()); mocks.observe.mockClear();
    await expect(service.applyEventForSession({ ...scope, bindingGeneration: 1, eventId: 2 })).rejects.toThrow('INVALID');
    let release!: () => void; const block = runRdcOperation('context-s1', () => new Promise<void>(resolve => { release = resolve; }));
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const first = service.applyEventForSession({ ...scope, bindingGeneration: 1, eventId: 1 });
    const latest = service.applyEventForSession({ ...scope, bindingGeneration: 1, eventId: 9 });
    release(); await block; await Promise.all([first, latest]);
    expect(mocks.observe).toHaveBeenCalledTimes(1);
    expect(mocks.observe.mock.calls[0][1]).toEqual({ event_id: 9 });
  });
  it('blocks new opens while deletion holds the input boundary', async () => {
    const service = new RdcSessionService();
    await service.blockInputOperations('p', 'capture', async () => {
      await expect(service.openProjectInput(request())).rejects.toThrow('REMOVING');
    });
    await service.openProjectInput(request());
  });
});

it('drops an in-flight old observation when replacement has advanced the generation', async () => {
  const service = new RdcSessionService(); await service.openProjectInput(request());
  let release!: (value: unknown) => void;
  mocks.observe.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const states: Array<{ generation: number; appliedEventId: number | null }> = [];
  service.subscribe(state => states.push(state));
  const apply = service.applyEventForSession({ ...scope, bindingGeneration: 1, eventId: 1 });
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  const replacement = service.openProjectInput({ ...request(), inputId: 'replacement' });
  await vi.waitFor(() => expect(service.snapshotReplayForSession(scope).generation).toBe(2));
  release({ appliedEventId: 1, imageEventId: 1 });
  await Promise.all([apply, replacement]);
  expect(states.filter(state => state.generation === 2).some(state => state.appliedEventId === 1)).toBe(false);
});
it('closes and invalidates an opened capture if source bytes changed during native opening', async () => {
  mocks.hash.mockResolvedValueOnce({ sha256: 'a'.repeat(64) }).mockResolvedValueOnce({ sha256: 'b'.repeat(64) });
  const service = new RdcSessionService();
  await expect(service.openProjectInput(request())).rejects.toThrow('CHANGED_DURING_OPEN');
  expect(service.snapshotReplayForSession(scope).captureHash).toBeNull();
  expect(service.snapshotOpenedCaptureForSession(scope)).toBeNull();
  expect(mocks.observe).not.toHaveBeenCalled();
});

it('rejects old binding generation for apply and close after a replacement', async () => {
  const service = new RdcSessionService(); await service.openProjectInput(request()); await service.openProjectInput(request());
  await expect(service.applyEventForSession({ ...scope, bindingGeneration: 1, eventId: 1 })).rejects.toThrow('BINDING_CHANGED');
  await expect(service.clearOpenedCaptureForSession(scope, { expectedGeneration: 1 })).rejects.toThrow('BINDING_CHANGED');
  expect(service.snapshotOpenedCaptureForSession(scope)).not.toBeNull();
});
it('quarantine blocks manual event/refresh but leaves confirmed close available for recovery', async () => {
  const service = new RdcSessionService(); await service.openProjectInput(request());
  const lease = setRdcRuntimeContextForSession('s1', { contextId: 'context-s1', runtimeOwner: 'app', ownerLeaseId: 'owner', replaySessionId: 'native-s1', backend: 'local', updatedAt: Date.now() }, { projectId: 'p' })!;
  quarantineRdcContext('s1', lease.version, 'uncertain');
  await expect(service.applyEventForSession({ ...scope, bindingGeneration: 1, eventId: 1 })).rejects.toThrow('QUARANTINED');
  await expect(service.refreshFrameForSession({ ...scope, bindingGeneration: 1 })).rejects.toThrow('QUARANTINED');
  expect(service.snapshotReplayForSession(scope).error?.retry).toBe('close');
  expect(await service.clearOpenedCaptureForSession(scope)).toBe(true);
});

it('publishes quarantine on Agent lock release instead of leaving a ready remote capture', async () => {
  mocks.observe.mockResolvedValueOnce({ appliedEventId: 9, imageEventId: 9, error: null,
    devicePresentation: { status: 'presented', eventId: 9, textureId: 'texture', sequence: 1, reason: null } });
  const service = new RdcSessionService(); await openRemote(service);
  const lease = setRdcRuntimeContextForSession('s1', { contextId: 'context-s1', runtimeOwner: 'app', ownerLeaseId: 'owner', replaySessionId: 'native-s1', backend: 'remote', updatedAt: Date.now() }, { projectId: 'p' })!;
  const listener = vi.fn(); service.subscribe(listener);
  setRdcInteractionLock('s1', 'test', true);
  quarantineRdcContext('s1', lease.version, 'native failure');
  setRdcInteractionLock('s1', 'test', false);
  expect(listener.mock.lastCall?.[0]).toMatchObject({ phase: 'error', interactionLock: null,
    error: { code: 'RDC_CONTEXT_QUARANTINED', retry: 'close' },
    devicePresentation: { status: 'unavailable', sequence: null } });
  expect(service.snapshotReplayForSession(scope).phase).toBe('error');
  expect(service.snapshotOpenedCaptureForSession(scope)).not.toBeNull();
  expect(await service.clearOpenedCaptureForSession(scope)).toBe(true);
  expect(service.snapshotReplayForSession(scope).phase).toBe('closed');
});

it('retains Android reservation across same-device replacement while selection persistence waits', async () => {
  const service = new RdcSessionService(); await openRemote(service);
  let release!: () => void;
  mocks.saveSelection.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  const replacing = service.openProjectInput(request('s1', true), { expectedGeneration: service.snapshotReplayForSession(scope).generation });
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  await expect(openRemote(service, 's2')).rejects.toThrow('DEVICE_IN_USE');
  expect(service.getDeviceOwner('android')).toEqual(scope);
  release(); await replacing;
  expect(service.getDeviceOwner('android')).toEqual(scope);
});
it('rejects stale incoming open and select without altering the replacement', async () => {
  const service = new RdcSessionService(); await service.openProjectInput(request());
  await expect(service.openProjectInput(request(), { expectedGeneration: 0 })).rejects.toThrow('BINDING_CHANGED');
  await expect(service.switchActiveCapture({ ...scope, bindingGeneration: 0 }, 'capture')).rejects.toThrow('BINDING_CHANGED');
  expect(mocks.close).not.toHaveBeenCalled();
});
it('rechecks the Agent lock when a queued close reaches native execution', async () => {
  const service = new RdcSessionService(); await service.openProjectInput(request());
  let release!: () => void;
  const busy = runRdcOperation('context-s1', () => new Promise<void>(resolve => { release = resolve; }));
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  const closing = service.clearOpenedCaptureForSession(scope);
  await vi.waitFor(() => expect(service.snapshotReplayForSession(scope).phase).toBe('closing'));
  setRdcInteractionLock('s1', 'test', true);
  const rejected = expect(closing).rejects.toThrow('LOCKED');
  release(); await busy; await rejected;
  expect(mocks.close).not.toHaveBeenCalled();
  expect(service.snapshotOpenedCaptureForSession(scope)).not.toBeNull();
});
it('does not start native open after Agent preparation arrives during hashing', async () => {
  const service = new RdcSessionService(); let release!: (value: unknown) => void;
  mocks.hash.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const opening = service.openProjectInput(request());
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  setRdcInteractionLock('s1', 'test', true);
  const rejected = expect(opening).rejects.toThrow('LOCKED');
  release({ sha256: 'a'.repeat(64) }); await rejected;
  expect(service.snapshotOpenedCaptureForSession(scope)).toBeNull();
});
it('harvests leftover owned daemons after closeAll', async () => {
  const service = new RdcSessionService();
  await service.openProjectInput(request());
  await service.closeAll();
  expect(mocks.close).toHaveBeenCalled();
  expect(harvestOwnedRdcDaemons).toHaveBeenCalledTimes(1);
});

it('fails closeAll when leftover harvest cannot confirm release', async () => {
  vi.mocked(harvestOwnedRdcDaemons).mockResolvedValueOnce({
    released: [],
    failed: [{ contextId: 'rdc-left', error: 'daemon still owned' }],
  });
  const service = new RdcSessionService();
  await expect(service.closeAll()).rejects.toThrow('CLOSE_FAILED');
});

it('does not attribute the preceding EID to a failed Agent observation', async () => {
  const service = new RdcSessionService(); await service.openProjectInput(request());
  mocks.observe.mockRejectedValueOnce(new Error('native image outcome unknown'));
  await service.observeAgentOperation(scope, 'rd.event.set_active', 'tool-new');
  expect(service.snapshotReplayForSession(scope).appliedEventId).toBeNull();
  expect(service.snapshotReplayForSession(scope).target).toBeNull();
  expect(mocks.append).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ eventId: null,
    toolCallId: 'tool-new', failure: expect.stringContaining('RDC_OBSERVE_FAILED') }), undefined);
});
it('uses one replay projection for Agent and human operations and reports unsaved evidence', async () => {
  const service = new RdcSessionService(); await service.openProjectInput(request());
  const image = { imagePath: 'live:1:9', width: 1, height: 1, source: 'framebuffer_screenshot', updatedAt: 1 };
  const observation = { nativeRevision: 7, modificationState: 'intervention', displayParameters: { mip: 0, slice: 0, sample: 0, rangeMin: 0, rangeMax: 1 } };
  mocks.observe.mockResolvedValueOnce({ appliedEventId: 9, imageEventId: 9, image, observation });
  mocks.append.mockRejectedValueOnce(new Error('REPLAY_QUOTA_EXCEEDED'));
  await service.observeAgentOperation(scope, 'rd.shader.edit_and_replace', 'agent-tool');
  expect(service.snapshotReplayForSession(scope)).toMatchObject({ requestedEventId: 9, appliedEventId: 9,
    imageEventId: 9, image, observation, error: { code: 'REPLAY_SAVE_FAILED', message: expect.stringContaining('QUOTA') } });
  expect(mocks.append).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ nativeRevision: 7,
    modificationState: 'intervention', displayParameters: observation.displayParameters }), expect.any(Buffer));
  mocks.observe.mockResolvedValueOnce({ appliedEventId: 1, imageEventId: 1, image: { ...image, imagePath: 'live:1:1' } });
  await service.applyEventForSession({ ...scope, bindingGeneration: 1, eventId: 1 });
  expect(service.snapshotReplayForSession(scope)).toMatchObject({ requestedEventId: 1, appliedEventId: 1, imageEventId: 1,
    image: { imagePath: 'live:1:1' } });
  mocks.observe.mockRejectedValueOnce(new Error('observation failed'));
  await service.observeAgentOperation(scope, 'rd.event.set_active', 'failed-tool');
  expect(service.snapshotReplayForSession(scope)).toMatchObject({ requestedEventId: null, appliedEventId: null,
    imageEventId: null, image: null, error: { code: 'RDC_OBSERVE_FAILED' } });
});
it('correlates lifecycle stages with one main-owned operation ID and assigns fresh mutation IDs', async () => {
  const service = new RdcSessionService(); const states: Array<{ operationId: string | null; phase: string }> = [];
  service.subscribe(state => states.push(state));
  await service.openProjectInput(request());
  const openId = service.snapshotReplayForSession(scope).operationId;
  expect(openId).toMatch(/^[0-9a-f-]{36}$/);
  expect(new Set(states.map(state => state.operationId))).toEqual(new Set([openId]));
  await service.applyEventForSession({ ...scope, bindingGeneration: 1, eventId: 1 });
  const applyId = service.snapshotReplayForSession(scope).operationId;
  expect(applyId).not.toBe(openId);
  const offset = states.length;
  await service.clearOpenedCaptureForSession(scope);
  const closeId = service.snapshotReplayForSession(scope).operationId;
  expect(closeId).not.toBe(applyId);
  expect(new Set(states.slice(offset).map(state => state.operationId))).toEqual(new Set([closeId]));
});

describe('selecting a session device before Capture Open', () => {
  const choose = (service: RdcSessionService, deviceId: string, generation = service.snapshotReplayForSession(scope).generation, confirmationToken?: string) => service.prepareDevice({ ...scope, deviceId, bindingGeneration: generation, confirmationToken });
  it.each([false, true])('reselecting the opened capture device preserves replay even when current CLI settings changed (remote=%s)', async remote => {
    const service = new RdcSessionService();
    if (remote) await openRemote(service); else await service.openProjectInput(request());
    mocks.prepare.mockClear(); mocks.close.mockClear(); mocks.identity.mockResolvedValue('new-cli');
    const before = service.snapshotReplayForSession(scope);
    const result = await choose(service, remote ? 'android' : 'local');
    expect(result.success).toBe(true); expect(result.state).toEqual(before);
    expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.close).not.toHaveBeenCalled();
  });
  it('reserves and connects immediately without a capture, then Open consumes the same prepared context', async () => {
    const service = new RdcSessionService();
    expect((await choose(service, 'android')).success).toBe(true);
    const prepared = service.snapshotReplayForSession(scope);
    expect(prepared).toMatchObject({ phase: 'closed', inputId: null, contextId: 'context-s1', preparation: { targetDeviceId: 'android', phase: 'ready', issue: null } });
    expect(service.snapshotOpenedCaptureForSession(scope)).toBeNull(); expect(service.getDeviceOwner('android')).toEqual(scope);
    await service.openProjectInput(request('s1', true), { expectedGeneration: prepared.generation });
    expect(mocks.prepare).toHaveBeenCalledOnce(); expect(mocks.close).not.toHaveBeenCalled();
    expect(service.snapshotReplayForSession(scope).phase).toBe('ready');
  });
  it('requires a one-use close confirmation and cancelling it preserves the current capture and target', async () => {
    const service = new RdcSessionService(); await service.openProjectInput(request());
    const before = service.snapshotReplayForSession(scope);
    const offer = await choose(service, 'android'); expect(offer.confirmation?.kind).toBe('close_capture');
    expect(service.snapshotReplayForSession(scope)).toEqual(before); expect(mocks.prepare).not.toHaveBeenCalled();
    await service.cancelDevicePreparation({ ...scope, bindingGeneration: before.generation });
    expect(service.snapshotReplayForSession(scope)).toEqual(before); expect(mocks.close).not.toHaveBeenCalled();
    await expect(choose(service, 'android', before.generation, offer.confirmation!.token)).rejects.toThrow('CONFIRMATION_STALE');
    const next = await choose(service, 'android');
    await choose(service, 'android', before.generation, next.confirmation!.token);
    expect(mocks.close).toHaveBeenCalledOnce(); expect(service.snapshotOpenedCaptureForSession(scope)).toBeNull();
    await expect(choose(service, 'android', service.snapshotReplayForSession(scope).generation, next.confirmation!.token)).rejects.toThrow('CONFIRMATION_STALE');
  });
  it('does not use generic cancellation to close an actual capture', async () => {
    const service = new RdcSessionService(); await service.openProjectInput(request());
    await expect(service.cancelDevicePreparation({ ...scope, bindingGeneration: 1 })).rejects.toThrow('CAPTURE_CLOSE_REQUIRED');
    expect(mocks.close).not.toHaveBeenCalled(); expect(service.snapshotOpenedCaptureForSession(scope)).not.toBeNull();
  });
  it('deduplicates pending requests and accepts latest A→B→Local intents even before generation events arrive', async () => {
    const service = new RdcSessionService(); let started!: () => void; const entered = new Promise<void>(resolve => { started = resolve; });
    mocks.prepare.mockImplementationOnce(async (_scope, _device, options: {signal:AbortSignal}) => {
      started(); await new Promise<void>((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once:true }));
    });
    const first = choose(service, 'A', 0); await entered;
    const same = choose(service, 'A', 0); expect(mocks.prepare).toHaveBeenCalledOnce();
    const second = choose(service, 'B', 0); const local = choose(service, 'local', 0);
    await Promise.all([first, same, second, local]);
    expect(service.snapshotReplayForSession(scope).preparation).toMatchObject({ targetDeviceId: 'local', phase: 'ready' });
    expect(service.getDeviceOwner('A')).toBeNull(); expect(service.getDeviceOwner('B')).toBeNull();
    expect(mocks.prepare.mock.calls.map(call => call[1].id)).toEqual(['A', 'local']);
  });
  it('disconnects a prepared connection without a capture and releases its reservation', async () => {
    const service = new RdcSessionService(); await choose(service, 'android');
    await service.cancelDevicePreparation({ ...scope, bindingGeneration: service.snapshotReplayForSession(scope).generation });
    expect(mocks.close).toHaveBeenCalledOnce(); expect(service.getDeviceOwner('android')).toBeNull();
    expect(service.snapshotReplayForSession(scope)).toMatchObject({ contextId: null, inputId: null, preparation: { phase: 'cancelled' } });
  });
  it('preserves the native committed installation receipt when cancelling preparation, without claiming rollback', async () => {
    const service = new RdcSessionService(); let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
    mocks.prepare.mockImplementationOnce(async (_scope, _device, options) => {
      entered(); options.onPreparationStage('installing');
      await new Promise<void>(resolve => options.signal.addEventListener('abort', () => resolve(), { once: true }));
      options.onInstallation({ installedApk: true, uninstalledExisting: false, installMode: 'update' });
      throw new Error('cancelled');
    });
    const preparing = choose(service, 'android'); await started;
    expect(service.snapshotReplayForSession(scope).preparation.phase).toBe('installing');
    const cancelled = await service.cancelDevicePreparation({ ...scope, bindingGeneration: service.snapshotReplayForSession(scope).generation });
    await preparing;
    expect(cancelled.state.preparation).toMatchObject({ phase: 'cancelled', installation: { installedApk: true, uninstalledExisting: false, installMode: 'update' } });
    expect(cancelled.state.contextId).toBeNull(); expect(service.getDeviceOwner('android')).toBeNull();
  });
  it('does not advance public revisions for repeated native phases and still publishes later phases and final failure', async () => {
    const service = new RdcSessionService(); const states: Array<{ revision: number; phase: string }> = [];
    service.subscribe(state => states.push({ revision: state.revision, phase: state.preparation.phase }));
    mocks.prepare.mockImplementationOnce(async (_scope, _device, options) => {
      options.onPreparationStage('starting'); const first = service.snapshotReplayForSession(scope).revision;
      options.onPreparationStage('starting'); options.onPreparationStage('starting');
      expect(service.snapshotReplayForSession(scope).revision).toBe(first);
      options.onPreparationStage('installing'); const next = service.snapshotReplayForSession(scope).revision;
      expect(next).toBe(first + 1); options.onPreparationStage('installing');
      expect(service.snapshotReplayForSession(scope).revision).toBe(next);
      throw new Error('native connection failed');
    });
    const result = await choose(service, 'android');
    expect(states.filter(state => state.phase === 'starting')).toHaveLength(1);
    expect(states.filter(state => state.phase === 'installing')).toHaveLength(1);
    expect(result.state.preparation).toMatchObject({ phase: 'failed', issue: { diagnostic: 'native connection failed' } });
    expect(mocks.close).toHaveBeenCalledOnce(); expect(service.getDeviceOwner('android')).toBeNull();
  });
  it('does not let a stale confirmation or locked request mutate a replacement', async () => {
    const service = new RdcSessionService(); await service.openProjectInput(request());
    const offer = await choose(service, 'android');
    await service.clearOpenedCaptureForSession(scope);
    await expect(choose(service, 'android', 1, offer.confirmation!.token)).rejects.toThrow('BINDING_CHANGED');
    setRdcInteractionLock('s1', 'guard', true);
    await expect(choose(service, 'android')).rejects.toThrow('INTERACTION_LOCKED');
    expect(mocks.prepare).not.toHaveBeenCalled(); setRdcInteractionLock('s1', 'guard', false);
  });
});

it('binds human repair to the selected device/native assessment and consumes a token once', async () => {
  const assessment = { fingerprint: 'f'.repeat(64), actions: ['reinstall_helper'], package_name: 'helper', device_serial: 'SERIAL',
    apk_sha256: 'a'.repeat(64), installed_identity: 'old-install', service_identity: [] };
  mocks.prepare.mockRejectedValueOnce(new RdcNativeFailure('Needs repair', 'rd.remote.connect', false, false,
    { code: 'remote_repair_required', category: 'runtime', exitCode: 1, details: { remote: { code: 'remote_repair_required', stage: 'checking', repair: assessment } } }));
  const service = new RdcSessionService(); const first = await service.prepareDevice({ ...scope, bindingGeneration: 0, deviceId: 'android' });
  expect(first.state.preparation).toMatchObject({ targetDeviceId: 'android', phase: 'needs_action', issue: { code: 'remote_repair_required', recovery: 'repair' } });
  expect(first.confirmation).toMatchObject({ kind: 'repair', issue: { repair: { fingerprint: assessment.fingerprint, deviceSerial: 'SERIAL' } } });
  const generation = first.state.generation;
  const fixed = await service.prepareDevice({ ...scope, bindingGeneration: generation, deviceId: 'android', confirmationToken: first.confirmation!.token });
  expect(fixed.success).toBe(true); expect(mocks.prepare.mock.calls[1][2]).toMatchObject({ repairFingerprint: assessment.fingerprint });
  await expect(service.prepareDevice({ ...scope, bindingGeneration: fixed.state.generation, deviceId: 'android', confirmationToken: first.confirmation!.token })).rejects.toThrow('CONFIRMATION_STALE');
});
it('refuses a repair assessment for another device and never forwards its permission', async () => {
  mocks.prepare.mockRejectedValueOnce(new RdcNativeFailure('Wrong device', 'rd.remote.connect', false, false,
    { code: 'remote_repair_required', category: 'runtime', exitCode: 1, details: { remote: { code: 'remote_repair_required', stage: 'checking', repair: {
      fingerprint: 'f'.repeat(64), actions: ['restart_helper'], package_name: 'helper', device_serial: 'FOREIGN', apk_sha256: 'a'.repeat(64), installed_identity: 'old', service_identity: [] } } } }));
  const service = new RdcSessionService(); const result = await service.prepareDevice({ ...scope, deviceId: 'android', bindingGeneration: 0 });
  expect(result.confirmation).toBeUndefined(); expect(result.error).toMatchObject({ code: 'RDC_REMOTE_REPAIR_IDENTITY_MISMATCH', recovery: 'configure_tools' });
  expect(service.getDeviceOwner('android')).toBeNull();
});
it('retains the primary owner failure, recovery guidance and device reservation when preparation cleanup also fails', async () => {
  const details = { context_id: 'context-s1', state_path: '/private/owner-state', reason: 'owner_identity_unavailable',
    recovery_hint: 'Inspect the owner before recovering this context.' };
  let primary: unknown;
  try { parseRdcNativeResult({ exitCode: 1, stdout: JSON.stringify({ schema_version: '3.0.0', result_kind: 'rdc_tool.cli',
    ok: false, error: { code: 'daemon_owner_unavailable', category: 'runtime', message: 'Original owner failure', details } }),
    stderr: '', duration_ms: 1 }, undefined, 'rd.remote.connect'); } catch (error) { primary = error; }
  mocks.prepare.mockRejectedValueOnce(primary); mocks.close.mockRejectedValueOnce(new Error('cleanup owner exit remains unconfirmed'));
  const service = new RdcSessionService();
  await expect(service.prepareDevice({ ...scope, deviceId: 'android', bindingGeneration: 0 })).rejects.toBe(primary);
  expect(primary).toMatchObject({ nativeError: { code: 'daemon_owner_unavailable', details } });
  const failed = service.snapshotReplayForSession(scope);
  expect(failed.preparation).toMatchObject({ phase: 'failed', issue: { code: 'daemon_owner_unavailable', recovery: 'retry' } });
  expect(failed.preparation.issue?.diagnostic).toContain('Original owner failure');
  expect(failed.preparation.issue?.diagnostic).toContain(details.recovery_hint);
  expect(failed.preparation.issue?.diagnostic).toContain('Cleanup not confirmed: cleanup owner exit remains unconfirmed');
  expect(service.getDeviceOwner('android')).toEqual(scope);
  expect(mocks.prepare).toHaveBeenCalledOnce(); expect(mocks.close).toHaveBeenCalledOnce();
  await expect(service.prepareDevice({ projectId: 'p', sessionId: 's2', deviceId: 'android', bindingGeneration: 0 })).rejects.toThrow('DEVICE_IN_USE');
});

it('retains reservations if failed preparation cannot confirm its native cleanup', async () => {
  mocks.prepare.mockRejectedValueOnce(new Error('connect failed')); mocks.close.mockRejectedValueOnce(new Error('exit unconfirmed'));
  const service = new RdcSessionService();
  await expect(service.prepareDevice({ ...scope, deviceId: 'android', bindingGeneration: 0 })).rejects.toThrow('exit unconfirmed');
  expect(service.getDeviceOwner('android')).toEqual(scope);
  await expect(service.prepareDevice({ projectId: 'p', sessionId: 's2', deviceId: 'android', bindingGeneration: 0 })).rejects.toThrow('DEVICE_IN_USE');
});

it('atomically reserves a device across two session queues after both old contexts finish closing', async () => {
  const service = new RdcSessionService(); await service.openProjectInput(request()); await service.openProjectInput(request('s2'));
  const secondScope = { projectId: 'p', sessionId: 's2' };
  const offerA = await service.prepareDevice({ ...scope, deviceId: 'android', bindingGeneration: 1 });
  const offerB = await service.prepareDevice({ ...secondScope, deviceId: 'android', bindingGeneration: 1 });
  const releases: Array<() => void> = [];
  mocks.close.mockImplementation(() => new Promise<void>(resolve => releases.push(resolve)));
  const first = service.prepareDevice({ ...scope, deviceId: 'android', bindingGeneration: 1, confirmationToken: offerA.confirmation!.token });
  const second = service.prepareDevice({ ...secondScope, deviceId: 'android', bindingGeneration: 1, confirmationToken: offerB.confirmation!.token });
  await vi.waitFor(() => expect(releases).toHaveLength(2)); releases.forEach(resolve => resolve());
  const outcomes = await Promise.all([first, second]);
  expect(outcomes.filter(result => result.success)).toHaveLength(1);
  expect(outcomes.find(result => !result.success)?.error?.code).toBe('RDC_DEVICE_IN_USE');
  expect(mocks.prepare).toHaveBeenCalledOnce();
  const winner = outcomes.find(result => result.success)!.state;
  expect(service.getDeviceOwner('android')).toEqual({ projectId: winner.projectId, sessionId: winner.sessionId });
});
it('invalidates repair confirmation when the configured native installation or catalog changes', async () => {
  mocks.prepare.mockRejectedValueOnce(new RdcNativeFailure('Needs repair', 'rd.remote.connect', false, false,
    { code: 'remote_repair_required', category: 'runtime', exitCode: 1, details: { remote: { code: 'remote_repair_required', stage: 'checking', repair: {
      fingerprint: 'f'.repeat(64), actions: ['reinstall_helper'], package_name: 'helper', device_serial: 'SERIAL', apk_sha256: 'a'.repeat(64), installed_identity: 'old', service_identity: [] } } } }));
  const service = new RdcSessionService(); const offer = await service.prepareDevice({ ...scope, deviceId: 'android', bindingGeneration: 0 });
  mocks.identity.mockResolvedValue('different-native-install');
  await expect(service.prepareDevice({ ...scope, deviceId: 'android', bindingGeneration: offer.state.generation, confirmationToken: offer.confirmation!.token })).rejects.toThrow('CONFIRMATION_STALE');
  expect(mocks.prepare).toHaveBeenCalledOnce(); expect(service.getDeviceOwner('android')).toBeNull();
});

function unconfirmedInstall() {
  return new RdcNativeFailure('PackageManager result is unconfirmed', 'rd.remote.connect', false, false, {
    code: 'remote_install_unconfirmed', category: 'runtime', exitCode: 1, details: {
      remote: { code: 'remote_install_unconfirmed', stage: 'installing', device_serial: 'SERIAL' },
      device_action: { kind: 'android_install', state: 'unconfirmed', device_serial: 'SERIAL', package_name: 'helper', apk_sha256: 'a'.repeat(64) },
      installation: { installed_apk: false, uninstalled_existing: true, install_mode: 'force_replace' },
    },
  });
}
it('keeps unconfirmed device actions and exclusivity after native cleanup, cancel and clear, blocking new prepare/Open/repair', async () => {
  mocks.prepare.mockRejectedValueOnce(unconfirmedInstall()); const service = new RdcSessionService();
  const result = await service.prepareDevice({ ...scope, deviceId: 'android', bindingGeneration: 0 });
  expect(result.state.preparation.issue).toMatchObject({ recovery: 'verify_installation', deviceAction: { kind: 'package_install', outcome: 'unconfirmed', uninstalledExisting: true } });
  expect(result.state.contextId).toBeNull(); expect(mocks.close).toHaveBeenCalledOnce(); expect(service.getDeviceOwner('android')).toEqual(scope);
  const generation = result.state.generation;
  const retry = await service.prepareDevice({ ...scope, deviceId: 'android', bindingGeneration: generation });
  expect(retry.success).toBe(false); expect(mocks.prepare).toHaveBeenCalledOnce();
  const latestGeneration = service.snapshotReplayForSession(scope).generation;
  const local = await service.prepareDevice({ ...scope, deviceId: 'local', bindingGeneration: latestGeneration });
  expect(local.success).toBe(false); expect(local.state.preparation.targetDeviceId).toBe('android');
  await expect(service.openProjectInput(request(), { expectedGeneration: latestGeneration })).rejects.toThrow('ACTION_UNCONFIRMED');
  const cancelled = await service.cancelDevicePreparation({ ...scope, bindingGeneration: latestGeneration }); expect(cancelled.success).toBe(false);
  await expect(service.clearOpenedCaptureForSession(scope)).rejects.toThrow('RDC_DEVICE_ACTION_UNCONFIRMED');
  expect(service.snapshotReplayForSession(scope).preparation.issue?.deviceAction?.outcome).toBe('unconfirmed');
  expect(service.getDeviceOwner('android')).toEqual(scope);
  await expect(service.prepareDevice({ projectId: 'p', sessionId: 's2', deviceId: 'android', bindingGeneration: 0 })).rejects.toThrow('DEVICE_IN_USE');
});
it('does not erase a cancelled install final receipt or start a queued replacement while PackageManager remains unconfirmed', async () => {
  const service = new RdcSessionService(); let enter!: () => void; const started = new Promise<void>(resolve => { enter = resolve; });
  mocks.prepare.mockImplementationOnce(async (_scope, _device, options) => {
    enter(); await new Promise<void>(resolve => options.signal.addEventListener('abort', () => resolve(), { once: true }));
    options.onDeviceAction({ code: 'remote_install_unconfirmed', stage: 'installing', diagnostic: 'PackageManager is pending', recovery: null,
      deviceAction: { kind: 'package_install', outcome: 'unconfirmed', uninstalledExisting: true } });
    throw new Error('cancelled');
  });
  const first = service.prepareDevice({ ...scope, deviceId: 'android', bindingGeneration: 0 }); await started;
  const next = service.prepareDevice({ ...scope, deviceId: 'local', bindingGeneration: 0 }); await Promise.all([first, next]);
  expect(mocks.prepare).toHaveBeenCalledOnce(); expect(service.getDeviceOwner('android')).toEqual(scope);
  expect(service.snapshotReplayForSession(scope).preparation).toMatchObject({ targetDeviceId: 'android', phase: 'failed', issue: { recovery: null, deviceAction: { outcome: 'unconfirmed' } } });
});
it('continues the same explicit device request only after read-only inspection proves clear with the original target and binding', async () => {
  const service = new RdcSessionService(); mocks.prepare.mockRejectedValueOnce(unconfirmedInstall());
  const first = await service.prepareDevice({ ...scope, deviceId: 'android', bindingGeneration: 0 });
  await expect(service.clearOpenedCaptureForSession(scope)).rejects.toThrow('RDC_DEVICE_ACTION_UNCONFIRMED');
  expect(service.snapshotReplayForSession(scope)).toMatchObject({ contextId: null, error: { code: 'RDC_DEVICE_ACTION_UNCONFIRMED' } });
  mocks.inspect.mockResolvedValueOnce({ state: 'clear', deviceSerial: 'SERIAL', packageName: 'helper', apkSha256: 'a'.repeat(64) });
  const recovered = await service.prepareDevice({ ...scope, deviceId: 'android', bindingGeneration: first.state.generation });
  expect(recovered.success).toBe(true); expect(recovered.state.preparation).toMatchObject({ phase: 'ready', targetDeviceId: 'android', issue: null });
  expect(recovered.state.error).toBeNull();
  expect(mocks.inspect).toHaveBeenCalledExactlyOnceWith(scope, expect.objectContaining({ id: 'android' }), expect.objectContaining({ expectedBindingIdentity: 'binding-old' }));
  expect(mocks.prepare).toHaveBeenCalledTimes(2);
  expect(mocks.prepare.mock.calls[1][2]).toMatchObject({ expectedBindingIdentity: 'binding-old' });
  expect(service.getDeviceOwner('android')).toEqual(scope);
});
it.each(['pending', 'unknown', 'changed_apk', 'inspection_failed'])('keeps the unresolved device claim and does not reconnect when verification is %s', async state => {
  const service = new RdcSessionService(); mocks.prepare.mockRejectedValueOnce(unconfirmedInstall());
  const first = await service.prepareDevice({ ...scope, deviceId: 'android', bindingGeneration: 0 });
  if (state === 'inspection_failed') mocks.inspect.mockRejectedValueOnce(new Error('RDC_DEVICE_CONFIRMATION_STALE'));
  else mocks.inspect.mockResolvedValueOnce({ state: state === 'changed_apk' ? 'clear' : state, deviceSerial: 'SERIAL', packageName: 'helper', apkSha256: (state === 'changed_apk' ? 'b' : 'a').repeat(64) });
  const verified = await service.prepareDevice({ ...scope, deviceId: 'android', bindingGeneration: first.state.generation });
  expect(verified.success).toBe(false); expect(verified.state.preparation.issue?.deviceAction?.outcome).toBe('unconfirmed');
  expect(mocks.prepare).toHaveBeenCalledOnce(); expect(service.getDeviceOwner('android')).toEqual(scope);
});
it('joins a cancelled read-only inspection without clearing the unresolved installation or starting another connect', async () => {
  const service = new RdcSessionService(); mocks.prepare.mockRejectedValueOnce(unconfirmedInstall());
  const first = await service.prepareDevice({ ...scope, deviceId: 'android', bindingGeneration: 0 });
  let enter!: () => void; const started = new Promise<void>(resolve => { enter = resolve; });
  mocks.inspect.mockImplementationOnce(async (_scope, _device, options) => {
    enter(); await new Promise<void>(resolve => options.signal.addEventListener('abort', () => resolve(), { once: true }));
    throw new Error('inspection cancelled');
  });
  const checking = service.prepareDevice({ ...scope, deviceId: 'android', bindingGeneration: first.state.generation }); await started;
  const cancelled = await service.cancelDevicePreparation({ ...scope, bindingGeneration: service.snapshotReplayForSession(scope).generation }); await checking;
  expect(cancelled.success).toBe(false); expect(cancelled.state.contextId).toBeNull();
  expect(cancelled.state.preparation).toMatchObject({ phase: 'failed', issue: { recovery: 'verify_installation', deviceAction: { outcome: 'unconfirmed' } } });
  expect(service.getDeviceOwner('android')).toEqual(scope); expect(mocks.prepare).toHaveBeenCalledOnce();
});
it.each(['offline', 'unauthorized', 'unknown'] as const)('retains unresolved installation facts and the device claim when discovery reports %s during read-only verification', async adbState => {
  const service = new RdcSessionService(); mocks.prepare.mockRejectedValueOnce(unconfirmedInstall());
  const first = await service.prepareDevice({ ...scope, deviceId: 'android', bindingGeneration: 0 });
  let release!: (value: unknown) => void; let enter!: () => void; const started = new Promise<void>(resolve => { enter = resolve; });
  mocks.inspect.mockImplementationOnce(async () => { enter(); return new Promise(resolve => { release = resolve; }); });
  const checking = service.prepareDevice({ ...scope, deviceId: 'android', bindingGeneration: first.state.generation }); await started;
  const snapshot: ReplayDeviceSnapshot = { revision: 1, discovery: { status: adbState === 'unknown' ? 'failed' : 'ready' }, devices: [
    { id: 'android', label: 'Phone', type: 'android', transport: 'adb_android', serial: 'SERIAL', status: 'offline', adbState },
  ] };
  for (const listener of mocks.deviceSubscribers) listener(snapshot);
  expect(mocks.inspect.mock.calls[0][2].signal.aborted).toBe(adbState !== 'unknown');
  release({ state: adbState === 'unknown' ? 'pending' : 'clear', deviceSerial: 'SERIAL', packageName: 'helper', apkSha256: 'a'.repeat(64) });
  const result = await checking;
  expect(result.success).toBe(false); expect(result.state.contextId).toBeNull(); expect(mocks.prepare).toHaveBeenCalledOnce();
  expect(result.state.preparation.issue).toMatchObject({ code: 'remote_install_unconfirmed', recovery: 'verify_installation', deviceAction: { outcome: 'unconfirmed', uninstalledExisting: true } });
  expect(service.getDeviceOwner('android')).toEqual(scope);
});

import { clearRdcContextLeases, setRdcRuntimeContextForSession, quarantineRdcContext } from './RdcRuntimeContextRegistry';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenProjectInputRequest } from '@shared/types/session';
const mocks = vi.hoisted(() => ({ close: vi.fn(), observe: vi.fn(), events: vi.fn(), append: vi.fn(), hash: vi.fn(), saveSelection: vi.fn(), liveRead: vi.fn(), liveClear: vi.fn() }));
vi.mock('../captures/replay/captureContentHash', () => ({ hashCaptureFile: mocks.hash }));
vi.mock('./StorageAdapter', () => ({ storageAdapter: { getProjectById: () => ({ rootPath: '/project' }) } }));
vi.mock('../captures/replay/ReplayHistoryStore', () => ({ replayHistoryStore: { saveSelection: mocks.saveSelection, append: mocks.append } }));
vi.mock('../captures/replay/ReplayLivePreviewStore', () => ({
  replayLivePreviewStore: { read: mocks.liveRead, clear: mocks.liveClear, write: vi.fn() },
}));
vi.mock('../tools/ShellInvocationService', () => ({ shellInvocationService: { hasUnconfirmedProcesses: () => false } }));
vi.mock('./OwnedRdcDaemonRegistry', () => ({ harvestOwnedRdcDaemons: vi.fn(async () => ({ released: [], failed: [] })) }));
vi.mock('./RdcReplayObservation', () => ({ observeReplay: mocks.observe, readReplayEvents: mocks.events }));
vi.mock('./RdcSessionRuntime', () => ({ RdcSessionRuntime: class {
  opened: Record<string, unknown> | null = null;
  async openProjectInput(request: OpenProjectInputRequest) {
    this.opened = { ...request, ownerSessionId: request.sessionId, contextId: `context-${request.sessionId}`,
      runtimeContext: { contextId: `context-${request.sessionId}`, replaySessionId: `native-${request.sessionId}` } };
    return this.opened;
  }
  getCliSettings() { return undefined; }
  getContextId() { return this.opened?.contextId ?? null; }
  snapshotOpenedCaptureForSession() { return this.opened; }
  snapshotContextForSession() { return this.opened; }
  async clearOpenedCaptureForSession() { if (!this.opened) return false; await mocks.close(); this.opened = null; return true; }
} }));
import { harvestOwnedRdcDaemons } from './OwnedRdcDaemonRegistry';
import { RdcSessionService } from './RdcSessionService';
import { setRdcInteractionLock, runRdcOperation } from './RdcOperationCoordinator';
const scope = { projectId: 'p', sessionId: 's1' };
const request = (sessionId = 's1', remote = false): OpenProjectInputRequest => ({ projectId: 'p', sessionId,
  inputId: 'capture', filePath: '/project/capture.rdc', replayDevice: { id: remote ? 'android' : 'local',
    type: remote ? 'android' : 'local', label: 'device', status: 'online', transport: 'local' } });
beforeEach(() => { clearRdcContextLeases(); vi.clearAllMocks(); mocks.hash.mockReset(); mocks.hash.mockResolvedValue({ sha256: 'a'.repeat(64) }); mocks.close.mockResolvedValue(undefined);
  mocks.events.mockResolvedValue([{ eventId: 1 }, { eventId: 9 }]);
  mocks.observe.mockResolvedValue({ appliedEventId: 9, imageEventId: 9, error: null });
  mocks.liveRead.mockResolvedValue(Buffer.from('png'));
  setRdcInteractionLock('s1', 'test', false);
});
describe('per-session capture lifecycle', () => {
  it('keeps same capture independent across sessions', async () => {
    const service = new RdcSessionService(); await service.openProjectInput(request()); await service.openProjectInput(request('s2'));
    expect(mocks.close).not.toHaveBeenCalled();
    expect(service.snapshotOpenedCaptureForSession(scope)?.contextId).toBe('context-s1');
    await service.clearOpenedCaptureForSession(scope);
    expect(service.snapshotOpenedCaptureForSession({ ...scope, sessionId: 's2' })?.contextId).toBe('context-s2');
  });
  it('retains remote device reservation on close failure', async () => {
    const service = new RdcSessionService(); await service.openProjectInput(request('s1', true));
    mocks.close.mockRejectedValueOnce(new Error('close uncertain'));
    await expect(service.clearOpenedCaptureForSession(scope)).rejects.toThrow('uncertain');
    await expect(service.openProjectInput(request('s2', true))).rejects.toThrow('DEVICE_IN_USE');
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
  const service = new RdcSessionService(); await service.openProjectInput(request('s1', true));
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
  const service = new RdcSessionService(); await service.openProjectInput(request('s1', true));
  let release!: () => void;
  mocks.saveSelection.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  const replacing = service.openProjectInput(request('s1', true), { expectedGeneration: 1 });
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  await expect(service.openProjectInput(request('s2', true))).rejects.toThrow('DEVICE_IN_USE');
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
it('keeps paired Agent pixels and metadata isolated from manual apply and reports unsaved output', async () => {
  const service = new RdcSessionService(); await service.openProjectInput(request());
  const image = { imagePath: 'live:1:9', width: 1, height: 1, source: 'framebuffer_screenshot', updatedAt: 1 };
  const observation = { nativeRevision: 7, modificationState: 'intervention', displayParameters: { mip: 0, slice: 0, sample: 0, rangeMin: 0, rangeMax: 1 } };
  mocks.observe.mockResolvedValueOnce({ appliedEventId: 9, imageEventId: 9, image, observation });
  mocks.append.mockRejectedValueOnce(new Error('REPLAY_QUOTA_EXCEEDED'));
  await service.observeAgentOperation(scope, 'rd.shader.edit_and_replace', 'agent-tool');
  const paired = service.snapshotReplayForSession(scope).agentObservation;
  expect(paired).toMatchObject({ eventId: 9, image, observation, saved: false, saveError: expect.stringContaining('QUOTA') });
  expect(mocks.append).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ nativeRevision: 7,
    modificationState: 'intervention', displayParameters: observation.displayParameters }), expect.any(Buffer));
  mocks.observe.mockResolvedValueOnce({ appliedEventId: 1, imageEventId: 1, image: { ...image, imagePath: 'live:1:1' } });
  await service.applyEventForSession({ ...scope, bindingGeneration: 1, eventId: 1 });
  expect(service.snapshotReplayForSession(scope).agentObservation).toEqual(paired);
  mocks.observe.mockRejectedValueOnce(new Error('observation failed'));
  await service.observeAgentOperation(scope, 'rd.event.set_active', 'failed-tool');
  expect(service.snapshotReplayForSession(scope).agentObservation).toEqual(paired);
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

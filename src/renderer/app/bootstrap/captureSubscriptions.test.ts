import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ElectronAPI } from '@shared/types/electron';
import type { ContextSnapshot } from '@shared/types/session';

const state = vi.hoisted(() => ({
  project: { currentProject: { projectId: 'project' }, currentSession: { sessionId: 'a' } },
  capture: { setContextSnapshot: vi.fn(), setCaptures: vi.fn(), setOpenedCapture: vi.fn() },
  projection: { projectContextSnapshot: vi.fn(), projectOpenedCapture: vi.fn() },
  device: { loadDevices: vi.fn(), applyStatusPayload: vi.fn() },
}));
vi.mock('../../stores/projectStore', () => ({ useProjectStore: { getState: () => state.project } }));
vi.mock('../../stores/captureStore', () => ({ useCaptureStore: { getState: () => state.capture } }));
vi.mock('../../stores/sessionProjectionStore', () => ({ useSessionProjectionStore: { getState: () => state.projection } }));
vi.mock('../../stores/deviceStore', () => ({ useDeviceStore: { getState: () => state.device } }));
import { createCaptureProjection, subscribeCaptureStatusChanged } from './captureSubscriptions';

describe('capture event subscriptions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.project.currentSession = { sessionId: 'a' };
  });

  it('keeps background snapshots in their projection without updating active capture UI', () => {
    const sync = vi.fn();
    const projector = createCaptureProjection({} as ElectronAPI, sync);
    projector.projectScopedContext({ projectId: 'project', sessionId: 'b', payload: null });
    expect(state.projection.projectContextSnapshot).toHaveBeenCalledWith('b', null);
    expect(state.capture.setContextSnapshot).not.toHaveBeenCalled();
    projector.projectScopedContext({ projectId: 'project', sessionId: 'a', payload: null });
    expect(state.capture.setCaptures).toHaveBeenCalledWith([]);
    expect(sync).not.toHaveBeenCalled();
  });

  it('late initial hydration after a session switch cannot overwrite the new session', async () => {
    let resolveContext!: (value: ContextSnapshot | null) => void;
    const context = new Promise<ContextSnapshot | null>((resolve) => { resolveContext = resolve; });
    const api = { context: { get: vi.fn(() => context) }, capture: { getOpenedState: vi.fn(async () => null) } };
    createCaptureProjection(api as unknown as ElectronAPI, vi.fn()).hydrate();
    state.project.currentSession = { sessionId: 'b' };
    resolveContext(null);
    await context;
    await Promise.resolve();
    expect(state.projection.projectContextSnapshot).toHaveBeenCalledWith('a', null);
    expect(state.capture.setContextSnapshot).not.toHaveBeenCalled();
    expect(state.capture.setOpenedCapture).not.toHaveBeenCalled();
  });

  it('ignores background status notifications and returns the exact subscription disposer', () => {
    let handler!: (value: unknown) => void;
    const unsubscribe = vi.fn();
    const get = vi.fn(async () => null);
    const api = { context: { get }, events: { onCaptureStatusChanged: (callback: typeof handler) => { handler = callback; return unsubscribe; } } };
    const dispose = subscribeCaptureStatusChanged(api as unknown as ElectronAPI, vi.fn());
    handler({ projectId: 'project', sessionId: 'b' });
    expect(get).not.toHaveBeenCalled();
    handler({ projectId: 'project', sessionId: 'a' });
    expect(get).toHaveBeenCalledWith({ projectId: 'project', sessionId: 'a' });
    dispose();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});

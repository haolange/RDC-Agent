import { beforeEach, expect, it, vi } from 'vitest';
import type { RuntimePermissionState } from '@shared/types/runtimePermission';
import type { WorkbenchIpcContext } from './workbenchContext';

const fixture = vi.hoisted(() => ({
  handle: vi.fn(),
  unsubscribe: vi.fn(),
  listener: null as ((state: RuntimePermissionState) => void) | null,
  state: { mode: 'default', revision: 1 } as RuntimePermissionState,
}));
vi.mock('electron', () => ({ ipcMain: { handle: fixture.handle } }));
vi.mock('../agent-runtime/permissions/RuntimePermissionStateService', () => ({ runtimePermissionStateService: {
  getSnapshot: () => fixture.state,
  subscribe: (listener: (state: RuntimePermissionState) => void) => { fixture.listener = listener; return fixture.unsubscribe; },
} }));
import { registerRuntimePermissionHandlers } from './runtimePermissionHandlers';

beforeEach(() => { fixture.handle.mockClear(); fixture.unsubscribe.mockClear(); });

it('exposes only the current state and rejects arguments on the readonly channel', () => {
  registerRuntimePermissionHandlers({ broadcastToRenderer: vi.fn() } as unknown as WorkbenchIpcContext);
  expect(fixture.handle).toHaveBeenCalledWith('runtime:getPermissionState', expect.any(Function));
  const handler = fixture.handle.mock.calls[0][1];
  expect(handler({})).toEqual({ mode: 'default', revision: 1 });
  expect(() => handler({}, { mode: 'full-access' })).toThrow();
});

it('replaces the previous subscription and broadcasts current revisions without settings data', () => {
  const broadcastToRenderer = vi.fn();
  registerRuntimePermissionHandlers({ broadcastToRenderer } as unknown as WorkbenchIpcContext);
  registerRuntimePermissionHandlers({ broadcastToRenderer } as unknown as WorkbenchIpcContext);
  expect(fixture.unsubscribe).toHaveBeenCalled();
  fixture.listener!({ mode: 'full-access', revision: 2 });
  expect(broadcastToRenderer).toHaveBeenCalledWith('runtime:permissionStateChanged', { mode: 'full-access', revision: 2 });
});

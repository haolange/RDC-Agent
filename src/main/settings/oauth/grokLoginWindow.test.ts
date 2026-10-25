import { EventEmitter } from 'node:events';
import { beforeEach, expect, it, vi } from 'vitest';
import { openGrokLoginWindow } from './grokLoginWindow';
import type { OAuthFlowState } from './oauthTypes';

const mocks = vi.hoisted(() => ({ windows: [] as unknown[], fail: false, pending: false,
  rejectLoad: undefined as undefined | ((error: Error) => void) }));
vi.mock('electron', () => ({ BrowserWindow: class extends EventEmitter {
  static getFocusedWindow = () => undefined;
  destroyed = false;
  webContents = Object.assign(new EventEmitter(), {
    session: { setPermissionRequestHandler: vi.fn() }, setWindowOpenHandler: vi.fn(),
  });
  constructor(public options: Record<string, unknown>) { super(); mocks.windows.push(this); }
  loadURL = vi.fn(async () => {
    if (mocks.pending) await new Promise((_resolve, reject) => { mocks.rejectLoad = reject; });
    if (mocks.fail) throw new Error('offline');
  });
  isDestroyed = () => this.destroyed;
  close = vi.fn(() => { this.destroyed = true; this.emit('closed'); });
} }));
import { BrowserWindow } from 'electron';
type TestWindow = EventEmitter & { options: { webPreferences: Record<string, unknown> }; destroyed: boolean;
  close: () => void; loadURL: ReturnType<typeof vi.fn>; webContents: EventEmitter & {
    session: { setPermissionRequestHandler: ReturnType<typeof vi.fn> }; setWindowOpenHandler: ReturnType<typeof vi.fn>;
  } };
const window = () => mocks.windows.at(-1) as TestWindow;
const flow = (): OAuthFlowState => ({ providerId: 'grok-account', flowId: 'owned', state: 's',
  expiresAt: Date.now() + 60000, redirectUri: 'http://127.0.0.1:3456/callback', abortController: new AbortController() });
beforeEach(() => { mocks.windows.length = 0; mocks.fail = false; mocks.pending = false; mocks.rejectLoad = undefined; });

it('returns the login flow while the authorization page is still loading', async () => {
  mocks.pending = true;
  const attempt = flow(); let returned = false;
  void openGrokLoginWindow(attempt, 'https://auth.x.ai/authorize').then(() => { returned = true; });
  try {
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(returned).toBe(true);
    expect(window().destroyed).toBe(false);
  } finally { attempt.abortController!.abort(); }
});

it('opens an ephemeral sandbox browser without preload or OS-browser delegation', async () => {
  const attempt = flow(); await openGrokLoginWindow(attempt, 'https://auth.x.ai/authorize');
  expect(window().options.webPreferences).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'grok-login-owned' });
  expect(window().options.webPreferences).not.toHaveProperty('preload');
  const permission = vi.fn(); window().webContents.session.setPermissionRequestHandler.mock.calls[0][0](null, 'media', permission);
  expect(permission).toHaveBeenCalledWith(false);
  expect(window().loadURL).toHaveBeenCalledWith('https://auth.x.ai/authorize');
  expect(BrowserWindow).toBeDefined(); attempt.abortController!.abort();
});
it('closes on flow cancellation and cancels a user-closed window', async () => {
  const cancelled = flow(); await openGrokLoginWindow(cancelled, 'https://auth.x.ai/authorize');
  cancelled.abortController!.abort(); expect(window().destroyed).toBe(true); expect(cancelled.error).toBeUndefined();
  const closed = flow(); await openGrokLoginWindow(closed, 'https://auth.x.ai/authorize');
  window().close(); expect(closed.abortController!.signal.aborted).toBe(true); expect(closed.error).toContain('closed');
});
it('allows only HTTPS or its own loopback callback and keeps popups in the owned window', async () => {
  const attempt = flow(); await openGrokLoginWindow(attempt, 'https://auth.x.ai/authorize');
  const event = { preventDefault: vi.fn() };
  window().webContents.emit('will-redirect', event, `${attempt.redirectUri}?state=s`); expect(event.preventDefault).not.toHaveBeenCalled();
  const open = window().webContents.setWindowOpenHandler.mock.calls[0][0];
  expect(open({ url: 'https://accounts.x.ai/login' })).toEqual({ action: 'deny' });
  expect(window().loadURL).toHaveBeenCalledWith('https://accounts.x.ai/login');
  window().webContents.emit('will-navigate', event, 'file:///private');
  expect(event.preventDefault).toHaveBeenCalledOnce(); expect(attempt.abortController!.signal.aborted).toBe(true);
});
it('releases the window on page-load failure', async () => {
  mocks.fail = true; const attempt = flow();
  await openGrokLoginWindow(attempt, 'https://auth.x.ai/authorize');
  await vi.waitFor(() => expect(attempt.abortController!.signal.aborted).toBe(true));
  expect(window().destroyed).toBe(true); expect(attempt.error).toContain('network');
});
it('does not turn cancellation into a late navigation error', async () => {
  mocks.pending = true; const attempt = flow();
  await openGrokLoginWindow(attempt, 'https://auth.x.ai/authorize');
  attempt.abortController!.abort(); mocks.rejectLoad!(new Error('navigation cancelled'));
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(window().destroyed).toBe(true); expect(attempt.error).toBeUndefined();
});

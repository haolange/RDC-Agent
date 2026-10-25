import { BrowserWindow } from 'electron';
import type { OAuthFlowState } from './oauthTypes';

/** An ephemeral, unprivileged browser owned by one Grok authorization attempt. */
export async function openGrokLoginWindow(flow: OAuthFlowState, authorizationUrl: string): Promise<void> {
  flow.abortController?.signal.throwIfAborted();
  const window = new BrowserWindow({
    title: 'Grok sign-in · RDC-Agent', width: 560, height: 760, autoHideMenuBar: true,
    parent: BrowserWindow.getFocusedWindow() ?? undefined,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false,
      webSecurity: true, allowRunningInsecureContent: false, partition: `grok-login-${flow.flowId}` },
  });
  const close = () => { if (!window.isDestroyed()) window.close(); };
  const fail = (message: string) => { flow.error = message; flow.abortController?.abort(); };
  const allowsNavigation = (target: string) => {
    try {
      const url = new URL(target);
      if (url.protocol === 'https:') return true;
      const callback = new URL(flow.redirectUri!);
      return url.origin === callback.origin && url.pathname === callback.pathname;
    } catch { return false; }
  };
  flow.abortController?.signal.addEventListener('abort', close, { once: true });
  window.once('closed', () => {
    flow.abortController?.signal.removeEventListener('abort', close);
    if (!flow.abortController?.signal.aborted) fail('Grok sign-in window was closed. Try signing in again.');
  });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  const guard = (event: Electron.Event, target: string) => {
    if (!allowsNavigation(target)) { event.preventDefault(); fail('Grok sign-in attempted an unsupported navigation.'); }
  };
  window.webContents.on('will-navigate', guard);
  window.webContents.on('will-redirect', guard);
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (allowsNavigation(url)) void window.loadURL(url).catch(() => fail('Grok sign-in page could not be loaded. Try again.'));
    return { action: 'deny' };
  });
  try { await window.loadURL(authorizationUrl); }
  catch (error) { fail('Grok sign-in page could not be loaded. Check your network and try again.'); throw error; }
}

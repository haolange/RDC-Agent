import { createRendererApi } from '@shared/renderer-api';
import { createDesktopTransport } from './desktopTransport';
import { installBrowserAppBridge } from './browserAppBridge/BrowserAppBridge';

export { browserAppBridgeInstalled } from './browserAppBridge/BrowserAppBridge';

/**
 * Builds `window.electronAPI` once, before the app renders: on the desktop preload's `rdcIpc`, or on the Browser QA
 * bridge when the page is served by it.
 */
export function installRendererApi(): void {
  if (typeof window === 'undefined' || window.electronAPI) return;
  if (window.rdcIpc) {
    window.electronAPI = createRendererApi(window.rdcIpc.platform, createDesktopTransport(window.rdcIpc));
    return;
  }
  installBrowserAppBridge();
}

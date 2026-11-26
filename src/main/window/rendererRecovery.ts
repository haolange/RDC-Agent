import { lifecycleLedger } from '../runtime/LifecycleLedger';
import { askRendererStartupFailure } from './rendererStartupFailure';
import type { BrowserWindow } from 'electron';
import type { RendererRecoveryAction } from '@shared/types/lifecycle';

/** The query parameter that boots the renderer into its failure page. */
export const RENDERER_CRASH_PARAM = 'rendererCrash';
const REPEAT_WINDOW_MS = 60_000;
/** A navigation the window itself replaced (a reload over a load); not a failure to start. */
const ERR_ABORTED = -3;

export interface RendererCrash {
  reason: string;
  exitCode: number;
}

/**
 * The renderer crash policy. The first death reloads the window. A second one within a minute boots the renderer into
 * its full-page failure view (reload, copy details) instead of looping. When even that page dies, or a document fails
 * to load, a native dialog offers Reload or Quit.
 */
export class RendererCrashPolicy {
  private lastCrashAt: number | null = null;

  decide(now: number, onFailurePage: boolean): RendererRecoveryAction {
    const repeated = this.lastCrashAt !== null && now - this.lastCrashAt < REPEAT_WINDOW_MS;
    this.lastCrashAt = now;
    if (onFailurePage) return 'native-dialog';
    return repeated ? 'crash-page' : 'reload';
  }

  reset(): void {
    this.lastCrashAt = null;
  }
}

const showsFailurePage = (url: string): boolean => {
  try {
    return new URL(url).searchParams.has(RENDERER_CRASH_PARAM);
  } catch {
    return false;
  }
};

export interface RendererRecoveryHost {
  /** Loads the renderer entry; with a crash, into its failure page. */
  load: (crash?: RendererCrash) => void;
  quit: () => void;
  isShuttingDown: () => boolean;
}

/** Records every renderer death and load failure of the main window and answers it by the crash policy. */
export function bindRendererRecovery(window: BrowserWindow, host: RendererRecoveryHost): void {
  const policy = new RendererCrashPolicy();
  const contents = window.webContents;
  const ask = (reason: string) => {
    void askRendererStartupFailure(window, reason).then((choice) => {
      if (window.isDestroyed()) return;
      if (choice === 'quit') {
        host.quit();
        return;
      }
      policy.reset();
      host.load();
    });
  };
  const respond = (action: RendererRecoveryAction, crash: RendererCrash) => {
    lifecycleLedger.record({ kind: 'renderer_recovery', action, reason: crash.reason });
    if (action === 'reload') host.load();
    else if (action === 'crash-page') host.load(crash);
    else ask(crash.reason);
  };

  contents.on('render-process-gone', (_event, details) => {
    console.error('[RendererProcessGone]', details);
    if (details.reason === 'clean-exit') return;
    lifecycleLedger.record({
      kind: 'process_gone',
      process: 'renderer',
      reason: details.reason,
      exitCode: details.exitCode,
    });
    if (host.isShuttingDown() || window.isDestroyed()) return;
    const crash = { reason: details.reason, exitCode: details.exitCode };
    respond(policy.decide(Date.now(), showsFailurePage(contents.getURL())), crash);
  });

  contents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    console.error('[RendererLoadFailed]', { errorCode, errorDescription, validatedURL });
    if (!isMainFrame || errorCode === ERR_ABORTED || host.isShuttingDown() || window.isDestroyed()) return;
    respond('native-dialog', { reason: `load-failed:${errorCode}`, exitCode: errorCode });
  });
}

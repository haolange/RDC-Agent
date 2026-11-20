import { BrowserWindow, dialog } from 'electron';
import { runtimeLogService } from '../runtime/RuntimeLogService';

export interface MainConfirmation {
  /** Stable action id for logs, e.g. `knowledge.write` or `trust.mcp`. */
  action: string;
  title: string;
  message: string;
  detail: string;
  confirmLabel: string;
  cancelLabel: string;
}

/**
 * Asks the person at the app in a native dialog that the renderer can neither draw nor answer. Without
 * a focused window nothing is confirmed, except a Browser QA run with explicit full access, which is logged.
 */
export async function confirmInMainProcess(request: MainConfirmation): Promise<boolean> {
  const owner = BrowserWindow.getFocusedWindow() ?? undefined;
  if (!owner) {
    if (process.env.RDC_AGENT_BROWSER_QA !== '1' || process.env.RDC_AGENT_BROWSER_QA_FULL_ACCESS !== '1') return false;
    runtimeLogService.log({
      scope: 'app',
      namespace: 'context',
      severity: 'warning',
      title: 'Browser QA confirmation auto-accepted',
      summary: `${request.action} was auto-confirmed because Browser QA full access is explicitly enabled.`,
      raw: { action: request.action, detail: request.detail },
    });
    return true;
  }
  const result = await dialog.showMessageBox(owner, {
    type: 'warning',
    buttons: [request.confirmLabel, request.cancelLabel],
    defaultId: 1,
    cancelId: 1,
    title: request.title,
    message: request.message,
    detail: request.detail,
    noLink: true,
  });
  return result.response === 0;
}

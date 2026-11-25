import { dialog } from 'electron';
import { runtimeLogService } from './RuntimeLogService';

/**
 * Faults that nothing else caught are written to the runtime log with their stack. An unhandled rejection is reported
 * and the process continues. An uncaught exception is reported and also shown in a native error box, as Electron does
 * when no listener is installed, because the main process may be in an inconsistent state afterwards.
 */
export function installProcessFaultHandlers(): void {
  process.on('unhandledRejection', (reason) => reportProcessFault('Unhandled promise rejection in main', reason));
  process.on('uncaughtException', (error) => {
    reportProcessFault('Uncaught exception in main', error);
    dialog.showErrorBox('RDC-Agent', `${error.message}\n\n${error.stack ?? ''}`);
  });
}

export function reportProcessFault(title: string, fault: unknown): void {
  const summary = fault instanceof Error ? fault.message : String(fault);
  console.error(`[main] ${title}:`, fault);
  try {
    runtimeLogService.log({
      scope: 'app', namespace: 'system', severity: 'error', title, summary,
      raw: { stack: fault instanceof Error ? fault.stack : undefined },
    });
  } catch (logError) {
    // Reporting a fault must not raise another one inside the fault handler.
    console.error('[main] runtime log unavailable while reporting a fault:', logError);
  }
}

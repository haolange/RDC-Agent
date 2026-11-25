import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { isHighImpactChannel, RENDERER_INVOKE_CHANNELS } from '@shared/renderer-api';
import { auditArgumentsHash, auditLog, runWithAuditOrigin, type AuditEvent, type AuditOrigin } from '../runtime/AuditLog';
import { isTrustedRendererUrl } from '../window/rendererTrust';

type InvokeHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown | Promise<unknown>;

const invokeHandlers = new Map<string, InvokeHandler>();
let registryInstalled = false;

const ERROR_CODE = /^([A-Z][A-Z0-9_]{2,})(?::|$)/;

/**
 * High-impact calls are audited with their origin and an argument fingerprint. The request is recorded before the
 * handler runs, so an unrecorded call never takes effect; the outcome record follows. The effect has already happened
 * when the outcome is appended, so a failure there is reported instead of being turned into an error for a call that
 * succeeded.
 */
async function dispatch(origin: AuditOrigin, channel: string, listener: InvokeHandler, event: IpcMainInvokeEvent, args: unknown[]): Promise<unknown> {
  return runWithAuditOrigin(origin, async () => {
    if (!isHighImpactChannel(channel)) return listener(event, ...args);
    const argumentsSha256 = auditArgumentsHash(args);
    auditLog.record({ kind: 'ipc', channel, argumentsSha256, outcome: 'requested' });
    try {
      const result = await listener(event, ...args);
      recordOutcome({ kind: 'ipc', channel, argumentsSha256, outcome: 'ok' });
      return result;
    } catch (error) {
      const code = error instanceof Error ? ERROR_CODE.exec(error.message)?.[1] : undefined;
      recordOutcome({ kind: 'ipc', channel, argumentsSha256, outcome: 'error', ...(code ? { errorCode: code } : {}) });
      throw error;
    }
  });
}

function recordOutcome(event: AuditEvent): void {
  try {
    auditLog.record(event);
  } catch (error) {
    process.stderr.write(`[audit] ${error instanceof Error ? error.message : String(error)}\n`);
  }
}

export function installIpcInvokeRegistry(): void {
  if (registryInstalled) {
    return;
  }

  const nativeHandle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = ((channel: string, listener: InvokeHandler): void => {
    invokeHandlers.set(channel, listener);
    // The Browser QA bridge authenticates separately and calls the stored listener directly.
    nativeHandle(channel, ((event: IpcMainInvokeEvent, ...args: unknown[]) => {
      if (!isTrustedRendererUrl(event.senderFrame?.url)) {
        throw new Error(`IPC_SENDER_REJECTED: ${channel} was invoked from a document other than the app entry.`);
      }
      return dispatch('desktop', channel, listener, event, args);
    }) as Parameters<typeof ipcMain.handle>[1]);
  }) as typeof ipcMain.handle;

  registryInstalled = true;
}

function createBrowserInvokeEvent(): IpcMainInvokeEvent {
  const sender = BrowserWindow.getFocusedWindow()?.webContents
    ?? BrowserWindow.getAllWindows().find((window) => !window.isDestroyed())?.webContents;

  return {
    sender,
  } as IpcMainInvokeEvent;
}

export async function invokeRegisteredIpcChannel(channel: string, args: unknown[] = []): Promise<unknown> {
  const handler = invokeHandlers.get(channel);
  if (!handler) {
    throw new Error(`No IPC handler registered for ${channel}`);
  }

  return dispatch('browser-qa', channel, handler, createBrowserInvokeEvent(), args);
}

export function hasRegisteredIpcChannel(channel: string): boolean {
  return invokeHandlers.has(channel);
}

export function assertRendererIpcParity(): void {
  const missingChannels = RENDERER_INVOKE_CHANNELS.filter((channel) => !invokeHandlers.has(channel));
  if (missingChannels.length > 0) {
    throw new Error(`Renderer IPC parity violation; missing handlers: ${missingChannels.join(', ')}`);
  }
}

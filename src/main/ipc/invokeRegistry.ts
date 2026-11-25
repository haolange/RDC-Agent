import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { AppError, IPC_ERROR_KEY, toIpcErrorPayload, type IpcErrorResult } from '@shared/errors/appError';
import { isHighImpactChannel, RENDERER_INVOKE_CHANNELS, type RendererInvokeChannel } from '@shared/renderer-api';
import { auditArgumentsHash, auditLog, runWithAuditOrigin, type AuditEvent, type AuditOrigin } from '../runtime/AuditLog';
import { redactCredentialLikeText } from '../runtime/secretRedaction';
import { isTrustedRendererUrl } from '../runtime/rendererTrust';

type InvokeHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown | Promise<unknown>;

/** Handlers of one domain keyed by their channel in the renderer channel table; each handler parses its raw arguments itself. */
export type IpcChannelTable = { readonly [Channel in RendererInvokeChannel]?: InvokeHandler };

const invokeHandlers = new Map<string, InvokeHandler>();
let registryInstalled = false;

/**
 * The single exit of every renderer call, desktop and Browser QA alike. A handler failure comes back as an
 * `IpcErrorResult` (registered code, params, failure class, redacted technical text) instead of a thrown message, so
 * the renderer branches and words the failure by code; success values are returned unchanged.
 *
 * High-impact calls are audited with their origin and an argument fingerprint. The request is recorded before the
 * handler runs, so an unrecorded call never takes effect; the outcome record follows. The effect has already happened
 * when the outcome is appended, so a failure there is reported instead of being turned into an error for a call that
 * succeeded.
 */
async function dispatch(origin: AuditOrigin, channel: string, listener: InvokeHandler, event: IpcMainInvokeEvent, args: unknown[]): Promise<unknown> {
  return runWithAuditOrigin(origin, async () => {
    const highImpact = isHighImpactChannel(channel);
    const argumentsSha256 = highImpact ? auditArgumentsHash(args) : '';
    try {
      if (highImpact) auditLog.record({ kind: 'ipc', channel, argumentsSha256, outcome: 'requested' });
      const result = await listener(event, ...args);
      if (highImpact) recordOutcome({ kind: 'ipc', channel, argumentsSha256, outcome: 'ok' });
      return result;
    } catch (error) {
      const payload = toIpcErrorPayload(error, redactCredentialLikeText);
      if (highImpact) recordOutcome({ kind: 'ipc', channel, argumentsSha256, outcome: 'error', errorCode: payload.code });
      if (payload.code === 'INTERNAL_ERROR') process.stderr.write(`[ipc] ${channel} failed: ${payload.technical ?? ''}\n`);
      return { [IPC_ERROR_KEY]: payload } satisfies IpcErrorResult;
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
        throw new AppError('IPC_SENDER_REJECTED', `${channel} was invoked from a document other than the app entry.`);
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

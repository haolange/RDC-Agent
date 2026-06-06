import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';

type InvokeHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown | Promise<unknown>;

const invokeHandlers = new Map<string, InvokeHandler>();
let registryInstalled = false;

export function installIpcInvokeRegistry(): void {
  if (registryInstalled) {
    return;
  }

  const nativeHandle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = ((channel: string, listener: InvokeHandler): void => {
    invokeHandlers.set(channel, listener);
    nativeHandle(channel, listener as Parameters<typeof ipcMain.handle>[1]);
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

  return handler(createBrowserInvokeEvent(), ...args);
}

export function hasRegisteredIpcChannel(channel: string): boolean {
  return invokeHandlers.has(channel);
}

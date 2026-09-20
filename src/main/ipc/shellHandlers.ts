import fs from 'fs';
import path from 'path';
import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, shell, type IpcMainInvokeEvent } from 'electron';

import { appPathService } from '../runtime/AppPathService';
import { acknowledgeGettingStarted, hasSeenGettingStarted } from '../runtime/GettingStartedState';
import { parseIpcArgs } from './validation/IpcPayloadGuard';
import { EmptyArgsSchema, SaveFileArgsSchema } from './validation/commonIpcSchemas';
import {
  AppCopyTextArgsSchema,
  AppGetAvatarDataUrlArgsSchema,
  AppOpenPathArgsSchema,
} from './validation/shellSchemas';

const AVATAR_MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
};

function getAvatarMimeType(filePath: string): string | null {
  return AVATAR_MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()] ?? null;
}

function isSameFilePath(left: string, right: string): boolean {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function copyAvatarToWorkspace(sourcePath: string): string | null {
  const mimeType = getAvatarMimeType(sourcePath);
  if (!mimeType || !fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
    return null;
  }

  const paths = appPathService.getRuntimePaths();
  const avatarDir = path.join(paths.profileStatePath, 'avatar');
  const extension = path.extname(sourcePath).toLowerCase();
  const avatarPath = path.join(avatarDir, `profile-avatar${extension}`);

  fs.mkdirSync(avatarDir, { recursive: true });
  if (!isSameFilePath(sourcePath, avatarPath)) {
    fs.copyFileSync(sourcePath, avatarPath);
  }

  return avatarPath;
}

function readAvatarDataUrl(avatarPath: string): string | null {
  const mimeType = getAvatarMimeType(avatarPath);
  if (!mimeType || !fs.existsSync(avatarPath) || !fs.statSync(avatarPath).isFile()) {
    return null;
  }

  const content = fs.readFileSync(avatarPath);
  return `data:${mimeType};base64,${content.toString('base64')}`;
}

function getSenderWindow(event: IpcMainInvokeEvent): BrowserWindow | null {
  const sender = event.sender as IpcMainInvokeEvent['sender'] | undefined;
  return sender ? BrowserWindow.fromWebContents(sender) : null;
}

export function registerShellHandlers(): void {
  ipcMain.handle('app:hasSeenGettingStarted', (_event, ...rawArgs: unknown[]) => {
    parseIpcArgs(EmptyArgsSchema, rawArgs, { label: 'app:hasSeenGettingStarted', maxBytes: 1024 });
    return hasSeenGettingStarted();
  });
  ipcMain.handle('app:acknowledgeGettingStarted', (_event, ...rawArgs: unknown[]) => {
    parseIpcArgs(EmptyArgsSchema, rawArgs, { label: 'app:acknowledgeGettingStarted', maxBytes: 1024 });
    acknowledgeGettingStarted();
  });
  ipcMain.handle('dialog:selectRdcFiles', async (_event, ...rawArgs: unknown[]) => {
    parseIpcArgs(EmptyArgsSchema, rawArgs, { label: 'dialog:selectRdcFiles', maxBytes: 1024 });
    const result = await dialog.showOpenDialog({
      filters: [{ name: 'RenderDoc Capture', extensions: ['rdc'] }],
      properties: ['openFile', 'multiSelections'],
    });
    return result.canceled ? null : result.filePaths;
  });

  ipcMain.handle('dialog:selectKnowledgeImport', async (_event, ...rawArgs: unknown[]) => {
    parseIpcArgs(EmptyArgsSchema, rawArgs, { label: 'dialog:selectKnowledgeImport', maxBytes: 1024 });
    const result = await dialog.showOpenDialog({
      filters: [
        { name: 'Knowledge package', extensions: ['zip'] },
        { name: 'Case YAML', extensions: ['yaml', 'yml'] },
      ],
      properties: ['openFile'],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle('dialog:selectFiles', async (_event, ...rawArgs: unknown[]) => {
    parseIpcArgs(EmptyArgsSchema, rawArgs, { label: 'dialog:selectFiles', maxBytes: 1024 });
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
    });
    return result.canceled ? null : result.filePaths;
  });

  ipcMain.handle('dialog:selectDirectory', async (_event, ...rawArgs: unknown[]) => {
    parseIpcArgs(EmptyArgsSchema, rawArgs, { label: 'dialog:selectDirectory', maxBytes: 1024 });
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('dialog:saveFile', async (_event, ...rawArgs: unknown[]) => {
    const [request] = parseIpcArgs(SaveFileArgsSchema, rawArgs, {
      label: 'dialog:saveFile',
      maxBytes: 4 * 1024,
    });
    const result = await dialog.showSaveDialog({
      defaultPath: request.defaultFileName,
      filters: [{ name: request.extension.toUpperCase(), extensions: [request.extension] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    return result.canceled || !result.filePath ? null : result.filePath;
  });

  ipcMain.handle('window:minimize', async (event, ...rawArgs: unknown[]) => {
    parseIpcArgs(EmptyArgsSchema, rawArgs, { label: 'window:minimize', maxBytes: 1024 });
    getSenderWindow(event)?.minimize();
  });

  ipcMain.handle('window:toggleMaximize', async (event, ...rawArgs: unknown[]) => {
    parseIpcArgs(EmptyArgsSchema, rawArgs, { label: 'window:toggleMaximize', maxBytes: 1024 });
    const window = getSenderWindow(event);
    if (!window) return false;

    if (window.isMaximized()) {
      window.unmaximize();
      return false;
    }

    window.maximize();
    return true;
  });

  ipcMain.handle('window:close', async (event, ...rawArgs: unknown[]) => {
    parseIpcArgs(EmptyArgsSchema, rawArgs, { label: 'window:close', maxBytes: 1024 });
    getSenderWindow(event)?.close();
  });

  ipcMain.handle('window:isMaximized', async (event, ...rawArgs: unknown[]) => {
    parseIpcArgs(EmptyArgsSchema, rawArgs, { label: 'window:isMaximized', maxBytes: 1024 });
    return getSenderWindow(event)?.isMaximized() ?? false;
  });

  ipcMain.handle('app:getMeta', async (_event, ...rawArgs: unknown[]) => {
    parseIpcArgs(EmptyArgsSchema, rawArgs, { label: 'app:getMeta', maxBytes: 1024 });
    return {
      version: app.getVersion(),
      productName: app.getName(),
      systemTheme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
      testMode: process.env.RDC_AGENT_TEST_MODE === '1',
    };
  });

  ipcMain.handle('app:selectAvatar', async (_event, ...rawArgs: unknown[]) => {
    parseIpcArgs(EmptyArgsSchema, rawArgs, { label: 'app:selectAvatar', maxBytes: 1024 });
    const result = await dialog.showOpenDialog({
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    try {
      return copyAvatarToWorkspace(result.filePaths[0]);
    } catch (error) {
      console.warn('[IPC] Failed to import avatar:', error);
      return null;
    }
  });

  ipcMain.handle('app:getAvatarDataUrl', async (_event, ...rawArgs: unknown[]) => {
    const [avatarPath] = parseIpcArgs(AppGetAvatarDataUrlArgsSchema, rawArgs, {
      label: 'app:getAvatarDataUrl',
      maxBytes: 8 * 1024,
    });
    if (!avatarPath) {
      return null;
    }

    try {
      return readAvatarDataUrl(avatarPath);
    } catch (error) {
      console.warn('[IPC] Failed to read avatar:', error);
      return null;
    }
  });

  ipcMain.handle('app:openPath', async (_event, ...rawArgs: unknown[]) => {
    try {
      const [targetPath] = parseIpcArgs(AppOpenPathArgsSchema, rawArgs, {
        label: 'app:openPath',
        maxBytes: 8 * 1024,
      });
      if (!targetPath) return { success: false, error: 'path is required' };
      try {
        const stats = fs.existsSync(targetPath) ? fs.statSync(targetPath) : null;
        if (stats?.isDirectory()) {
          await shell.openPath(targetPath);
        } else {
          shell.showItemInFolder(targetPath);
        }
      } catch {
        shell.showItemInFolder(targetPath);
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('app:copyText', async (_event, ...rawArgs: unknown[]) => {
    const [text] = parseIpcArgs(AppCopyTextArgsSchema, rawArgs, {
      label: 'app:copyText',
      maxBytes: 2 * 1024 * 1024,
    });
    clipboard.writeText(text ?? '');
    return { success: true };
  });

  ipcMain.handle('app:readClipboardText', async (_event, ...rawArgs: unknown[]) => {
    parseIpcArgs(EmptyArgsSchema, rawArgs, {
      label: 'app:readClipboardText',
    });
    return { success: true, text: clipboard.readText() };
  });
}

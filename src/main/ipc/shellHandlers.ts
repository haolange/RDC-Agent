import fs from 'fs';
import path from 'path';
import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, shell } from 'electron';

import { appPathService } from '../services/AppPathService';

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

  const paths = appPathService.getWorkspacePaths();
  const avatarDir = path.join(paths.profilesPath, 'avatar');
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

export function registerShellHandlers(): void {
  ipcMain.handle('dialog:selectRdcFiles', async () => {
    const result = await dialog.showOpenDialog({
      filters: [{ name: 'RenderDoc Capture', extensions: ['rdc'] }],
      properties: ['openFile', 'multiSelections'],
    });
    return result.canceled ? null : result.filePaths;
  });

  ipcMain.handle('dialog:selectFiles', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
    });
    return result.canceled ? null : result.filePaths;
  });

  ipcMain.handle('dialog:selectDirectory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('window:minimize', async (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.handle('window:toggleMaximize', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return false;

    if (window.isMaximized()) {
      window.unmaximize();
      return false;
    }

    window.maximize();
    return true;
  });

  ipcMain.handle('window:close', async (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  ipcMain.handle('window:isMaximized', async (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false;
  });

  ipcMain.handle('app:getMeta', async () => {
    return {
      version: app.getVersion(),
      productName: app.getName(),
      systemTheme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
    };
  });

  ipcMain.handle('app:selectAvatar', async () => {
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

  ipcMain.handle('app:getAvatarDataUrl', async (_event, avatarPath: string) => {
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

  ipcMain.handle('app:openPath', async (_event, targetPath: string) => {
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
  });

  ipcMain.handle('app:copyText', async (_event, text: string) => {
    clipboard.writeText(text ?? '');
    return { success: true };
  });
}

import { ipcMain } from 'electron';
import type { RuntimeLogScope } from '@shared/types/runtimeLog';
import type { TerminalCreateTabRequest } from '@shared/types/terminal';
import { runtimeLogService } from '../runtime/RuntimeLogService';
import { terminalSessionService } from '../runtime/TerminalSessionService';

export function registerRuntimeTerminalHandlers(): void {
  ipcMain.handle('runtimeLog:list', async (_event, request: { scope: RuntimeLogScope; sessionId?: string | null }) => {
    return {
      entries: runtimeLogService.list(request.scope, request.sessionId),
    };
  });

  ipcMain.handle('terminal:listTabs', async () => {
    return {
      tabs: terminalSessionService.listTabs(),
    };
  });

  ipcMain.handle('terminal:createTab', async (_event, request?: TerminalCreateTabRequest) => {
    try {
      const tab = terminalSessionService.createTab(request);
      return {
        success: true,
        tab,
        tabs: terminalSessionService.listTabs(),
      };
    } catch (error) {
      return {
        success: false,
        tabs: terminalSessionService.listTabs(),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle('terminal:closeTab', async (_event, tabId: string) => {
    try {
      return {
        success: true,
        tabs: terminalSessionService.closeTab(tabId),
      };
    } catch (error) {
      return {
        success: false,
        tabs: terminalSessionService.listTabs(),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle('terminal:activateTab', async (_event, tabId: string) => {
    return {
      success: true,
      tabs: terminalSessionService.activateTab(tabId),
    };
  });

  ipcMain.handle('terminal:write', async (_event, tabId: string, data: string) => {
    try {
      terminalSessionService.write(tabId, data);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle('terminal:resize', async (_event, tabId: string, cols: number, rows: number) => {
    try {
      terminalSessionService.resize(tabId, cols, rows);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

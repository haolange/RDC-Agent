import { ipcMain } from 'electron';
import type { RuntimeLogScope } from '@shared/types/runtimeLog';
import type { TerminalCreateTabRequest } from '@shared/types/terminal';
import { runtimeLogService } from '../runtime/RuntimeLogService';
import { terminalSessionService } from '../runtime/TerminalSessionService';
import { IpcValidationError, parseIpcArgs } from './validation/IpcPayloadGuard';
import { EmptyArgsSchema } from './validation/commonIpcSchemas';
import {
  RuntimeLogListArgsSchema,
  TerminalCreateTabArgsSchema,
  TerminalResizeArgsSchema,
  TerminalTabIdArgsSchema,
  TerminalWriteArgsSchema,
} from './validation/ipcSchemas';

export function registerRuntimeTerminalHandlers(): void {
  ipcMain.handle('runtimeLog:list', async (_event, ...rawArgs: unknown[]) => {
    const [request] = parseIpcArgs(RuntimeLogListArgsSchema, rawArgs, {
      label: 'runtimeLog:list',
      maxBytes: 8 * 1024,
    });
    return {
      entries: runtimeLogService.list(request.scope as RuntimeLogScope, request.sessionId),
    };
  });

  ipcMain.handle('terminal:listTabs', async (_event, ...rawArgs: unknown[]) => {
    parseIpcArgs(EmptyArgsSchema, rawArgs, { label: 'terminal:listTabs', maxBytes: 1024 });
    return {
      tabs: terminalSessionService.listTabs(),
    };
  });

  ipcMain.handle('terminal:createTab', async (_event, ...rawArgs: unknown[]) => {
    try {
      const [request] = parseIpcArgs(TerminalCreateTabArgsSchema, rawArgs, {
        label: 'terminal:createTab',
        maxBytes: 16 * 1024,
        padTo: 1,
      });
      const tab = terminalSessionService.createTab(request as TerminalCreateTabRequest | undefined);
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

  ipcMain.handle('terminal:closeTab', async (_event, ...rawArgs: unknown[]) => {
    try {
      const [tabId] = parseIpcArgs(TerminalTabIdArgsSchema, rawArgs, {
        label: 'terminal:closeTab',
        maxBytes: 4 * 1024,
      });
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

  ipcMain.handle('terminal:activateTab', async (_event, ...rawArgs: unknown[]) => {
    try {
      const [tabId] = parseIpcArgs(TerminalTabIdArgsSchema, rawArgs, {
        label: 'terminal:activateTab',
        maxBytes: 4 * 1024,
      });
      return {
        success: true,
        tabs: terminalSessionService.activateTab(tabId),
      };
    } catch (error) {
      return {
        success: false,
        tabs: terminalSessionService.listTabs(),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle('terminal:write', async (_event, ...rawArgs: unknown[]) => {
    try {
      const [tabId, data] = parseIpcArgs(TerminalWriteArgsSchema, rawArgs, {
        label: 'terminal:write',
        maxBytes: 96 * 1024,
      });
      terminalSessionService.write(tabId, data);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle('terminal:resize', async (_event, ...rawArgs: unknown[]) => {
    try {
      const [tabId, cols, rows] = parseIpcArgs(TerminalResizeArgsSchema, rawArgs, {
        label: 'terminal:resize',
        maxBytes: 4 * 1024,
      });
      terminalSessionService.resize(tabId, cols, rows);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof IpcValidationError || error instanceof Error
          ? error.message
          : String(error),
      };
    }
  });
}

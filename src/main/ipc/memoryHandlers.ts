import { ipcMain } from 'electron';
import type { MemoryWriteRequest } from '@shared/types/electron';
import { MemoryStore } from '../agent-runtime/memory';
import { appPathService } from '../runtime/AppPathService';
import type { WorkbenchIpcContext } from './workbenchContext';
import { ipcApprovalTokenService } from './validation/IpcApprovalTokenService';
import { IpcValidationError, parseIpcArgs } from './validation/IpcPayloadGuard';
import {
  MemoryDeleteArgsSchema,
  MemoryGetArgsSchema,
  MemoryIssueApprovalTokenArgsSchema,
  MemoryListArgsSchema,
  MemoryWriteArgsSchema,
} from './validation/ipcSchemas';

const storeFor = (scope: 'user' | 'project', projectRoot?: string): MemoryStore => {
  if (scope === 'project') {
    if (!projectRoot) throw new Error('Project scope memory requires a project root.');
    return new MemoryStore(appPathService.getProjectRdxPaths(projectRoot).memoryPath);
  }
  return new MemoryStore(appPathService.getUserRdxPaths().memoryPath);
};

function validationFailure(error: unknown): { success: false; name?: string; error: string } {
  const message = error instanceof Error ? error.message : String(error);
  return { success: false, error: message };
}

export function registerMemoryHandlers(_context: WorkbenchIpcContext): void {
  ipcMain.handle('memory:issueApprovalToken', async (_event, ...rawArgs: unknown[]) => {
    try {
      const [request] = parseIpcArgs(MemoryIssueApprovalTokenArgsSchema, rawArgs, {
        label: 'memory:issueApprovalToken',
        maxBytes: 8 * 1024,
      });
      const token = ipcApprovalTokenService.issue(request);
      return { token };
    } catch (error) {
      if (error instanceof IpcValidationError) {
        return { error: error.message };
      }
      throw error;
    }
  });

  ipcMain.handle('memory:list', async (_event, ...rawArgs: unknown[]) => {
    const [scope, projectRoot] = parseIpcArgs(MemoryListArgsSchema, rawArgs, {
      label: 'memory:list',
      maxBytes: 8 * 1024,
      padTo: 2,
    });
    return {
      memories: (await storeFor(scope, projectRoot).listMemories()).map((memory) => ({
        ...memory,
        scope,
      })),
    };
  });

  ipcMain.handle('memory:get', async (_event, ...rawArgs: unknown[]) => {
    const [scope, name, projectRoot] = parseIpcArgs(MemoryGetArgsSchema, rawArgs, {
      label: 'memory:get',
      maxBytes: 8 * 1024,
      padTo: 3,
    });
    const memory = await storeFor(scope, projectRoot).getMemory(name);
    return { memory: memory ? { ...memory, scope } : null };
  });

  ipcMain.handle('memory:write', async (_event, ...rawArgs: unknown[]) => {
    try {
      const [request] = parseIpcArgs(MemoryWriteArgsSchema, rawArgs, {
        label: 'memory:write',
        maxBytes: 512 * 1024,
      }) as [MemoryWriteRequest];
      const consumed = ipcApprovalTokenService.consume({
        token: request.approvalToken,
        action: 'memory.write',
        scope: request.scope,
        name: request.name,
        projectRoot: request.projectRoot,
      });
      if (!consumed) {
        return { success: false, name: request.name, error: 'Memory write requires a valid Main-issued approvalToken.' };
      }
      const memory = await storeFor(request.scope, request.projectRoot).writeMemory({
        name: request.name,
        description: request.description,
        type: request.type,
        content: request.content,
        tags: request.tags,
      });
      return { success: true, name: memory.name };
    } catch (error) {
      if (error instanceof IpcValidationError) return validationFailure(error);
      return {
        success: false,
        name: typeof (rawArgs[0] as { name?: unknown })?.name === 'string'
          ? (rawArgs[0] as { name: string }).name
          : undefined,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle('memory:delete', async (_event, ...rawArgs: unknown[]) => {
    try {
      const [scope, name, approvalToken, projectRoot] = parseIpcArgs(MemoryDeleteArgsSchema, rawArgs, {
        label: 'memory:delete',
        maxBytes: 8 * 1024,
        padTo: 4,
      });
      const consumed = ipcApprovalTokenService.consume({
        token: approvalToken,
        action: 'memory.delete',
        scope,
        name,
        projectRoot,
      });
      if (!consumed) {
        return { success: false, error: 'Memory deletion requires a valid Main-issued approvalToken.' };
      }
      return { success: await storeFor(scope, projectRoot).deleteMemory(name) };
    } catch (error) {
      return validationFailure(error);
    }
  });
}

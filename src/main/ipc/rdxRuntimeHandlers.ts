import { ipcMain, shell } from 'electron';
import type { HookEvent, ScopedResourceImportRequest, ScopedResourceKind, ScopedResourceWriteRequest } from '@shared/types/rdxRuntime';
import { hookEngine } from '../hooks/HookEngine';
import { requestSnapshotStore } from '../agent-runtime/prompt';
import { rdxRuntimeService } from '../runtime/RdxRuntimeService';
import { parseIpcArgs } from './validation/IpcPayloadGuard';
import {
  RdxRuntimeDeleteArgsSchema,
  RdxRuntimeGetSnapshotArgsSchema,
  RdxRuntimeListSnapshotsArgsSchema,
  RdxRuntimeOverviewArgsSchema,
  RdxRuntimeRevealArgsSchema,
  RdxRuntimeRevokeHookArgsSchema,
  RdxRuntimeRevokeMcpArgsSchema,
  RdxRuntimeTestHookArgsSchema,
  RdxRuntimeTrustHookArgsSchema,
  RdxRuntimeTrustMcpArgsSchema,
  ScopedResourceImportArgsSchema,
  ScopedResourceWriteArgsSchema,
} from './validation/rdxRuntimeSchemas';

export function registerRdxRuntimeHandlers(): void {
  ipcMain.handle('rdx-runtime:overview', (_event, ...rawArgs: unknown[]) => {
    const [projectRoot] = parseIpcArgs(RdxRuntimeOverviewArgsSchema, rawArgs, {
      label: 'rdx-runtime:overview',
      maxBytes: 8 * 1024,
      padTo: 1,
    });
    return rdxRuntimeService.overview(projectRoot);
  });

  ipcMain.handle('rdx-runtime:validate', (_event, ...rawArgs: unknown[]) => {
    const [request] = parseIpcArgs(ScopedResourceWriteArgsSchema, rawArgs, {
      label: 'rdx-runtime:validate',
      maxBytes: 2 * 1024 * 1024,
    }) as [ScopedResourceWriteRequest];
    const diagnostics = rdxRuntimeService.validate(request);
    return { valid: diagnostics.length === 0, diagnostics };
  });

  ipcMain.handle('rdx-runtime:upsert', (_event, ...rawArgs: unknown[]) => {
    const [request] = parseIpcArgs(ScopedResourceWriteArgsSchema, rawArgs, {
      label: 'rdx-runtime:upsert',
      maxBytes: 2 * 1024 * 1024,
    }) as [ScopedResourceWriteRequest];
    rdxRuntimeService.upsert(request);
    return rdxRuntimeService.overview(request.projectRoot);
  });

  ipcMain.handle('rdx-runtime:import', (_event, ...rawArgs: unknown[]) => {
    const [request] = parseIpcArgs(ScopedResourceImportArgsSchema, rawArgs, {
      label: 'rdx-runtime:import',
      maxBytes: 16 * 1024,
    }) as [ScopedResourceImportRequest];
    const document = rdxRuntimeService.importFromFile(request);
    return { overview: rdxRuntimeService.overview(request.projectRoot), id: document.id };
  });

  ipcMain.handle('rdx-runtime:delete', (_event, ...rawArgs: unknown[]) => {
    const [kind, scope, id, projectRoot] = parseIpcArgs(RdxRuntimeDeleteArgsSchema, rawArgs, {
      label: 'rdx-runtime:delete',
      maxBytes: 8 * 1024,
      padTo: 4,
    });
    rdxRuntimeService.delete(kind as ScopedResourceKind, scope, id, projectRoot);
    return rdxRuntimeService.overview(projectRoot);
  });

  ipcMain.handle('rdx-runtime:reveal', async (_event, ...rawArgs: unknown[]) => {
    try {
      const [sourcePath] = parseIpcArgs(RdxRuntimeRevealArgsSchema, rawArgs, {
        label: 'rdx-runtime:reveal',
        maxBytes: 8 * 1024,
      });
      shell.showItemInFolder(sourcePath);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('rdx-runtime:trustHook', (_event, ...rawArgs: unknown[]) => {
    const [projectRoot, hookId] = parseIpcArgs(RdxRuntimeTrustHookArgsSchema, rawArgs, {
      label: 'rdx-runtime:trustHook',
      maxBytes: 8 * 1024,
    });
    hookEngine.load(rdxRuntimeService.overview(projectRoot).userPaths.hooksPath, projectRoot);
    hookEngine.trustProjectHook(projectRoot, hookId);
    return rdxRuntimeService.overview(projectRoot);
  });

  ipcMain.handle('rdx-runtime:revokeHook', (_event, ...rawArgs: unknown[]) => {
    const [projectRoot, hookId] = parseIpcArgs(RdxRuntimeRevokeHookArgsSchema, rawArgs, {
      label: 'rdx-runtime:revokeHook',
      maxBytes: 8 * 1024,
    });
    hookEngine.revokeProjectHook(projectRoot, hookId);
    return rdxRuntimeService.overview(projectRoot);
  });

  ipcMain.handle('rdx-runtime:trustMcp', (_event, ...rawArgs: unknown[]) => {
    const [projectRoot, descriptorId] = parseIpcArgs(RdxRuntimeTrustMcpArgsSchema, rawArgs, {
      label: 'rdx-runtime:trustMcp',
      maxBytes: 8 * 1024,
    });
    return rdxRuntimeService.trustProjectMcp(projectRoot, descriptorId);
  });

  ipcMain.handle('rdx-runtime:revokeMcp', (_event, ...rawArgs: unknown[]) => {
    const [projectRoot, descriptorId] = parseIpcArgs(RdxRuntimeRevokeMcpArgsSchema, rawArgs, {
      label: 'rdx-runtime:revokeMcp',
      maxBytes: 8 * 1024,
    });
    return rdxRuntimeService.revokeProjectMcp(projectRoot, descriptorId);
  });

  ipcMain.handle('rdx-runtime:testHook', (_event, ...rawArgs: unknown[]) => {
    const [hookEvent, projectRoot, hookId] = parseIpcArgs(RdxRuntimeTestHookArgsSchema, rawArgs, {
      label: 'rdx-runtime:testHook',
      maxBytes: 8 * 1024,
      padTo: 3,
    });
    const overview = rdxRuntimeService.overview(projectRoot);
    const context = {
      event: hookEvent as HookEvent,
      projectRoot,
      payload: { test: true, hookId, overviewHash: overview.resources.length },
    };
    return hookId ? hookEngine.test(hookId, context) : hookEngine.trigger(hookEvent as HookEvent, context);
  });

  ipcMain.handle('rdx-runtime:listSnapshots', (_event, ...rawArgs: unknown[]) => {
    const [sessionId, turnId] = parseIpcArgs(RdxRuntimeListSnapshotsArgsSchema, rawArgs, {
      label: 'rdx-runtime:listSnapshots',
      maxBytes: 4 * 1024,
      padTo: 2,
    });
    return requestSnapshotStore.list(sessionId, turnId);
  });

  ipcMain.handle('rdx-runtime:getSnapshot', (_event, ...rawArgs: unknown[]) => {
    const [sessionId, turnId, snapshotId] = parseIpcArgs(RdxRuntimeGetSnapshotArgsSchema, rawArgs, {
      label: 'rdx-runtime:getSnapshot',
      maxBytes: 4 * 1024,
    });
    return requestSnapshotStore.get(sessionId, turnId, snapshotId);
  });
}

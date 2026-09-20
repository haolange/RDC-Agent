import { ipcMain, shell } from 'electron';
import type { HookEvent, ScopedResourceImportRequest, ScopedResourceKind, ScopedResourceWriteRequest } from '@shared/types/rdcRuntime';
import { hookEngine } from '../hooks/HookEngine';
import { requestSnapshotStore } from '../agent-runtime/prompt';
import { rdcRuntimeService } from '../runtime/RdcRuntimeService';
import { parseIpcArgs } from './validation/IpcPayloadGuard';
import {
  RdcRuntimeDeleteArgsSchema,
  RdcRuntimeGetSnapshotArgsSchema,
  RdcRuntimeListSnapshotsArgsSchema,
  RdcRuntimeOverviewArgsSchema,
  RdcRuntimeRevealArgsSchema,
  RdcRuntimeRevokeHookArgsSchema,
  RdcRuntimeRevokeMcpArgsSchema,
  RdcRuntimeTestHookArgsSchema,
  RdcRuntimeTrustHookArgsSchema,
  RdcRuntimeTrustMcpArgsSchema,
  ScopedResourceImportArgsSchema,
  ScopedResourceWriteArgsSchema,
} from './validation/rdcRuntimeSchemas';

function mutateHookTrust(
  projectRoot: string | undefined | null,
  hookId: string,
  mutate: (hookId: string, trustRoot?: string) => void,
) {
  const overviewRoot = projectRoot || undefined;
  hookEngine.load(rdcRuntimeService.overview(overviewRoot).userPaths.hooksPath, overviewRoot);
  const hook = hookEngine.list().find((entry) => entry.definition.id === hookId);
  // Same rule as renderer resolveHookTrustProjectRoot: only project-scope mutations receive a root.
  const trustRoot = hook?.scope === 'project' ? overviewRoot : undefined;
  mutate(hookId, trustRoot);
  return rdcRuntimeService.overview(overviewRoot);
}

export function registerRdcRuntimeHandlers(): void {
  ipcMain.handle('rdc-runtime:overview', (_event, ...rawArgs: unknown[]) => {
    const [projectRoot] = parseIpcArgs(RdcRuntimeOverviewArgsSchema, rawArgs, {
      label: 'rdc-runtime:overview',
      maxBytes: 8 * 1024,
      padTo: 1,
    });
    return rdcRuntimeService.overview(projectRoot);
  });

  ipcMain.handle('rdc-runtime:validate', (_event, ...rawArgs: unknown[]) => {
    const [request] = parseIpcArgs(ScopedResourceWriteArgsSchema, rawArgs, {
      label: 'rdc-runtime:validate',
      maxBytes: 2 * 1024 * 1024,
    }) as [ScopedResourceWriteRequest];
    const diagnostics = rdcRuntimeService.validate(request);
    return { valid: diagnostics.length === 0, diagnostics };
  });

  ipcMain.handle('rdc-runtime:upsert', (_event, ...rawArgs: unknown[]) => {
    const [request] = parseIpcArgs(ScopedResourceWriteArgsSchema, rawArgs, {
      label: 'rdc-runtime:upsert',
      maxBytes: 2 * 1024 * 1024,
    }) as [ScopedResourceWriteRequest];
    rdcRuntimeService.upsert(request);
    return rdcRuntimeService.overview(request.projectRoot);
  });

  ipcMain.handle('rdc-runtime:import', (_event, ...rawArgs: unknown[]) => {
    const [request] = parseIpcArgs(ScopedResourceImportArgsSchema, rawArgs, {
      label: 'rdc-runtime:import',
      maxBytes: 16 * 1024,
    }) as [ScopedResourceImportRequest];
    const document = rdcRuntimeService.importFromFile(request);
    return { overview: rdcRuntimeService.overview(request.projectRoot), id: document.id };
  });

  ipcMain.handle('rdc-runtime:delete', (_event, ...rawArgs: unknown[]) => {
    const [kind, scope, id, projectRoot] = parseIpcArgs(RdcRuntimeDeleteArgsSchema, rawArgs, {
      label: 'rdc-runtime:delete',
      maxBytes: 8 * 1024,
      padTo: 4,
    });
    rdcRuntimeService.delete(kind as ScopedResourceKind, scope, id, projectRoot);
    return rdcRuntimeService.overview(projectRoot);
  });

  ipcMain.handle('rdc-runtime:reveal', async (_event, ...rawArgs: unknown[]) => {
    try {
      const [sourcePath] = parseIpcArgs(RdcRuntimeRevealArgsSchema, rawArgs, {
        label: 'rdc-runtime:reveal',
        maxBytes: 8 * 1024,
      });
      shell.showItemInFolder(sourcePath);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('rdc-runtime:trustHook', (_event, ...rawArgs: unknown[]) => {
    const [projectRoot, hookId] = parseIpcArgs(RdcRuntimeTrustHookArgsSchema, rawArgs, {
      label: 'rdc-runtime:trustHook',
      maxBytes: 8 * 1024,
      padTo: 2,
    });
    return mutateHookTrust(projectRoot, hookId, (id, trustRoot) => {
      hookEngine.trustHook(id, trustRoot);
    });
  });

  ipcMain.handle('rdc-runtime:revokeHook', (_event, ...rawArgs: unknown[]) => {
    const [projectRoot, hookId] = parseIpcArgs(RdcRuntimeRevokeHookArgsSchema, rawArgs, {
      label: 'rdc-runtime:revokeHook',
      maxBytes: 8 * 1024,
      padTo: 2,
    });
    return mutateHookTrust(projectRoot, hookId, (id, trustRoot) => {
      hookEngine.revokeHook(id, trustRoot);
    });
  });

  ipcMain.handle('rdc-runtime:trustMcp', (_event, ...rawArgs: unknown[]) => {
    const [projectRoot, descriptorId] = parseIpcArgs(RdcRuntimeTrustMcpArgsSchema, rawArgs, {
      label: 'rdc-runtime:trustMcp',
      maxBytes: 8 * 1024,
    });
    return rdcRuntimeService.trustProjectMcp(projectRoot, descriptorId);
  });

  ipcMain.handle('rdc-runtime:revokeMcp', (_event, ...rawArgs: unknown[]) => {
    const [projectRoot, descriptorId] = parseIpcArgs(RdcRuntimeRevokeMcpArgsSchema, rawArgs, {
      label: 'rdc-runtime:revokeMcp',
      maxBytes: 8 * 1024,
    });
    return rdcRuntimeService.revokeProjectMcp(projectRoot, descriptorId);
  });

  ipcMain.handle('rdc-runtime:testHook', (_event, ...rawArgs: unknown[]) => {
    const [hookEvent, projectRoot, hookId] = parseIpcArgs(RdcRuntimeTestHookArgsSchema, rawArgs, {
      label: 'rdc-runtime:testHook',
      maxBytes: 8 * 1024,
      padTo: 3,
    });
    const overview = rdcRuntimeService.overview(projectRoot);
    const context = {
      event: hookEvent as HookEvent,
      projectRoot,
      payload: { test: true, hookId, overviewHash: overview.resources.length },
    };
    return hookId ? hookEngine.test(hookId, context) : hookEngine.trigger(hookEvent as HookEvent, context);
  });

  ipcMain.handle('rdc-runtime:listSnapshots', (_event, ...rawArgs: unknown[]) => {
    const [sessionId, turnId] = parseIpcArgs(RdcRuntimeListSnapshotsArgsSchema, rawArgs, {
      label: 'rdc-runtime:listSnapshots',
      maxBytes: 4 * 1024,
      padTo: 2,
    });
    return requestSnapshotStore.list(sessionId, turnId);
  });

  ipcMain.handle('rdc-runtime:getSnapshot', (_event, ...rawArgs: unknown[]) => {
    const [sessionId, turnId, snapshotId] = parseIpcArgs(RdcRuntimeGetSnapshotArgsSchema, rawArgs, {
      label: 'rdc-runtime:getSnapshot',
      maxBytes: 4 * 1024,
    });
    return requestSnapshotStore.get(sessionId, turnId, snapshotId);
  });
}

import { ipcMain, shell } from 'electron';
import type { HookEvent, ScopedResourceKind, ScopedResourceWriteRequest } from '@shared/types/rdxRuntime';
import { hookEngine } from '../hooks/HookEngine';
import { requestSnapshotStore } from '../agent-runtime/prompt';
import { rdxRuntimeService } from '../runtime/RdxRuntimeService';

export function registerRdxRuntimeHandlers(): void {
  ipcMain.handle('rdx-runtime:overview', (_event, projectRoot?: string) => rdxRuntimeService.overview(projectRoot));
  ipcMain.handle('rdx-runtime:validate', (_event, request: ScopedResourceWriteRequest) => {
    const diagnostics = rdxRuntimeService.validate(request);
    return { valid: diagnostics.length === 0, diagnostics };
  });
  ipcMain.handle('rdx-runtime:upsert', (_event, request: ScopedResourceWriteRequest) => {
    rdxRuntimeService.upsert(request);
    return rdxRuntimeService.overview(request.projectRoot);
  });
  ipcMain.handle('rdx-runtime:delete', (_event, kind: ScopedResourceKind, scope: 'user' | 'project', id: string, projectRoot?: string) => {
    rdxRuntimeService.delete(kind, scope, id, projectRoot);
    return rdxRuntimeService.overview(projectRoot);
  });
  ipcMain.handle('rdx-runtime:reveal', async (_event, sourcePath: string) => {
    try { shell.showItemInFolder(sourcePath); return { success: true }; }
    catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
  });
  ipcMain.handle('rdx-runtime:trustHook', (_event, projectRoot: string, hookId: string) => {
    hookEngine.load(rdxRuntimeService.overview(projectRoot).userPaths.hooksPath, projectRoot);
    hookEngine.trustProjectHook(projectRoot, hookId);
    return rdxRuntimeService.overview(projectRoot);
  });
  ipcMain.handle('rdx-runtime:revokeHook', (_event, projectRoot: string, hookId: string) => {
    hookEngine.revokeProjectHook(projectRoot, hookId);
    return rdxRuntimeService.overview(projectRoot);
  });
  ipcMain.handle('rdx-runtime:testHook', (_event, hookEvent: HookEvent, projectRoot?: string, hookId?: string) => {
    const overview = rdxRuntimeService.overview(projectRoot);
    const context = { event: hookEvent, projectRoot, payload: { test: true, hookId, overviewHash: overview.resources.length } };
    return hookId ? hookEngine.test(hookId, context) : hookEngine.trigger(hookEvent, context);
  });
  ipcMain.handle('rdx-runtime:listSnapshots', (_event, sessionId: string, turnId?: string) => requestSnapshotStore.list(sessionId, turnId));
  ipcMain.handle('rdx-runtime:getSnapshot', (_event, sessionId: string, turnId: string, snapshotId: string) => requestSnapshotStore.get(sessionId, turnId, snapshotId));
}

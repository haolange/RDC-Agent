import { ipcMain } from 'electron';
import type { MemoryWriteRequest } from '@shared/types/electron';
import { MemoryStore } from '../agent-runtime/memory';
import { appPathService } from '../runtime/AppPathService';
import type { WorkbenchIpcContext } from './workbenchContext';

const storeFor = (scope: 'user' | 'project', projectRoot?: string): MemoryStore => {
  if (scope === 'project') {
    if (!projectRoot) throw new Error('Project scope memory requires a project root.');
    return new MemoryStore(appPathService.getProjectRdxPaths(projectRoot).memoryPath);
  }
  return new MemoryStore(appPathService.getUserRdxPaths().memoryPath);
};

export function registerMemoryHandlers(_context: WorkbenchIpcContext): void {
  ipcMain.handle('memory:list', async (_event, scope: 'user' | 'project', projectRoot?: string) => ({ memories: (await storeFor(scope, projectRoot).listMemories()).map((memory) => ({ ...memory, scope })) }));
  ipcMain.handle('memory:get', async (_event, scope: 'user' | 'project', name: string, projectRoot?: string) => {
    const memory = await storeFor(scope, projectRoot).getMemory(name);
    return { memory: memory ? { ...memory, scope } : null };
  });
  ipcMain.handle('memory:write', async (_event, request: MemoryWriteRequest) => {
    if (request.approved !== true) return { success: false, name: request.name, error: 'Memory write requires explicit user approval.' };
    try { const memory = await storeFor(request.scope, request.projectRoot).writeMemory(request); return { success: true, name: memory.name }; }
    catch (error) { return { success: false, name: request.name, error: error instanceof Error ? error.message : String(error) }; }
  });
  ipcMain.handle('memory:delete', async (_event, scope: 'user' | 'project', name: string, confirmed: boolean, projectRoot?: string) => {
    if (!confirmed) return { success: false, error: 'Memory deletion requires confirmation.' };
    try { return { success: await storeFor(scope, projectRoot).deleteMemory(name) }; }
    catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
  });
}

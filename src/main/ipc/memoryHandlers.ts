import { ipcMain } from 'electron';
import { agentOrchestrator } from '../workflow/debugger/AgentOrchestrator';
import type { WorkbenchIpcContext } from './workbenchContext';

/**
 * Memory 面板 IPC handlers。
 *
 * 全部委托给 AgentOrchestrator 的 MemoryStore（共享单例），
 * 与 memory_read/write/delete 工具操作同一存储。
 */
export function registerMemoryHandlers(_context: WorkbenchIpcContext): void {
  ipcMain.handle('memory:list', async () => {
    const memories = await agentOrchestrator.listMemoriesForUi();
    return { memories };
  });

  ipcMain.handle('memory:get', async (_event, name: string) => {
    const memory = await agentOrchestrator.getMemoryForUi(name);
    return { memory };
  });

  ipcMain.handle('memory:write', async (_event, request: { name: string; description: string; type: 'user' | 'feedback' | 'project' | 'reference'; content: string; tags?: string[] }) => {
    return agentOrchestrator.writeMemoryForUi(request);
  });

  ipcMain.handle('memory:delete', async (_event, name: string) => {
    return agentOrchestrator.deleteMemoryForUi(name);
  });
}

import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { watch, type FSWatcher } from 'node:fs';
import { ProjectInputLifecycle } from '../captures/ProjectInputLifecycle';
import { replayHistoryStore } from '../captures/replay/ReplayHistoryStore';
import { storageAdapter } from '../sessions/StorageAdapter';
import { rdxSessionService } from '../sessions';
import { conversationService } from '../conversation/ConversationService';
import { runtimeLogService } from '../runtime/RuntimeLogService';
import { ipcApprovalTokenService } from './validation/IpcApprovalTokenService';
import { parseIpcArgs } from './validation/IpcPayloadGuard';
import { ProjectInputPrepareRemoveArgsSchema, ProjectInputRemoveArgsSchema } from './validation/projectSessionSchemas';
import type { WorkbenchIpcContext } from './workbenchContext';

export const projectInputLifecycle = new ProjectInputLifecycle({
  getProject: (id) => storageAdapter.getProjectById(id),
  refresh: (id) => storageAdapter.refreshProjectInputs(id),
  bindings: (id) => rdxSessionService.listBindingsForProject(id),
  close: (projectId, inputId) => rdxSessionService.closeMatchingCaptures(projectId, inputId),
  rebind: (projectId, inputId, input) => rdxSessionService.rebindInput(projectId, inputId, input),
  block: (projectId, inputId, operation) => rdxSessionService.blockInputOperations(projectId, inputId, operation),
  stop: async (sessionId) => {
    const result = await conversationService.cancelActiveTurn({ sessionId });
    if (!result.success) throw new Error(result.error || 'PROJECT_INPUT_STOP_FAILED');
  },
}, replayHistoryStore);

async function confirmRemoval(fileName: string, filePath: string, sessions: string[]): Promise<boolean> {
  const owner = BrowserWindow.getFocusedWindow() ?? undefined;
  if (process.env.RDC_AGENT_BROWSER_QA === '1' && !owner) return process.env.RDC_AGENT_BROWSER_QA_FULL_ACCESS === '1';
  if (!owner) return false;
  const result = await dialog.showMessageBox(owner, {
    type: 'warning', buttons: ['删除抓帧', '取消'], defaultId: 1, cancelId: 1, noLink: true,
    title: '删除项目抓帧', message: `删除 ${fileName}？`,
    detail: `${filePath}\n\n将关闭关联回放并删除这个 RDC 文件。没有其他同内容输入引用时，也会清理各会话关联的回放足迹。聊天、报告和正式调查证据保留。${sessions.length ? `\n关联会话：${sessions.join(', ')}` : ''}`,
  });
  return result.response === 0;
}

/** Installs one reconciliation path for imports, refresh, startup and file changes. */
export function registerProjectInputLifecycleHandlers(context: WorkbenchIpcContext): void {
  storageAdapter.projects.setInputReconciler((project, inputs) => projectInputLifecycle.reconcile(project, inputs));
  storageAdapter.projects.setInputCommitListener((projectId, inputs) => context.broadcastToRenderer('project:inputsChanged', { projectId, inputs }));
  ipcMain.handle('project:inputs:prepareRemove', async (_event, ...rawArgs: unknown[]) => {
    try {
      const [projectId, inputId] = parseIpcArgs(ProjectInputPrepareRemoveArgsSchema, rawArgs, { label: 'project:inputs:prepareRemove', maxBytes: 4096 });
      const prepared = await projectInputLifecycle.prepare(projectId, inputId);
      if (!await confirmRemoval(prepared.input.fileName, prepared.input.filePath, prepared.affectedSessionIds)) return { success: false };
      const approvalToken = ipcApprovalTokenService.issue({ action: 'project.input.delete', scope: 'project',
        projectRoot: prepared.project.rootPath, name: prepared.approvalIdentity });
      return { success: true, approvalToken, input: prepared.input, affectedSessionIds: prepared.affectedSessionIds };
    } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
  });
  ipcMain.handle('project:inputs:remove', async (_event, ...rawArgs: unknown[]) => {
    try {
      const [projectId, inputId, token] = parseIpcArgs(ProjectInputRemoveArgsSchema, rawArgs, { label: 'project:inputs:remove', maxBytes: 4096 });
      const prepared = await projectInputLifecycle.prepare(projectId, inputId);
      if (!ipcApprovalTokenService.consume({ token, action: 'project.input.delete', scope: 'project',
        projectRoot: prepared.project.rootPath, name: prepared.approvalIdentity })) throw new Error('PROJECT_INPUT_APPROVAL_INVALID');
      const result = await projectInputLifecycle.remove(projectId, inputId, prepared.approvalIdentity);
      if (result.success || result.fileDeleted) context.broadcastToRenderer('project:inputsChanged', { projectId, inputs: result.inputs });
      return result;
    } catch (error) { return { success: false, inputs: [], error: error instanceof Error ? error.message : String(error) }; }
  });
  installProjectInputWatchers(context);
}

function installProjectInputWatchers(context: WorkbenchIpcContext): void {
  const watchers = new Map<string, FSWatcher>();
  const pending = new Map<string, NodeJS.Timeout>();
  const lastErrors = new Map<string, string>();
  const report = (projectId: string, error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    if (lastErrors.get(projectId) === message) return;
    lastErrors.set(projectId, message);
    runtimeLogService.log({ scope: 'app', namespace: 'context', severity: 'error', projectId,
      title: 'Project capture reconciliation failed', summary: message });
    context.broadcastToRenderer('project:inputsError', { projectId, error: message });
  };
  const refresh = (projectId: string) => {
    if (pending.has(projectId)) clearTimeout(pending.get(projectId));
    pending.set(projectId, setTimeout(() => {
      pending.delete(projectId);
      void storageAdapter.refreshProjectInputs(projectId).then(inputs => {
        lastErrors.delete(projectId);
        context.broadcastToRenderer('project:inputsChanged', { projectId, inputs });
      }).catch(error => report(projectId, error));
    }, 250));
  };
  const sync = () => {
    const projects = storageAdapter.listProjects();
    for (const [projectId, watcher] of watchers) if (!projects.some(project => project.projectId === projectId)) {
      watcher.close(); watchers.delete(projectId);
    }
    for (const project of projects) {
      if (watchers.has(project.projectId)) continue;
      try {
        const watcher = watch(project.rootPath, { recursive: true, persistent: false }, (_event, filename) => {
          const name = filename?.toString().replace(/\\/gu, '/').toLowerCase();
          if (name === '.rdx' || name === '.rdx/inputs' || name?.startsWith('.rdx/inputs/')) refresh(project.projectId);
        });
        watcher.on('error', error => report(project.projectId, error));
        watchers.set(project.projectId, watcher);
        refresh(project.projectId);
      } catch (error) { report(project.projectId, error); }
    }
  };
  sync();
  const timer = setInterval(sync, 5000);
  timer.unref();
  app.once('before-quit', () => {
    clearInterval(timer);
    for (const timeout of pending.values()) clearTimeout(timeout);
    for (const watcher of watchers.values()) watcher.close();
    pending.clear(); watchers.clear();
  });
}

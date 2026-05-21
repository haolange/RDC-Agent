/**
 * IPC Handlers - 注册所有IPC处理�?
 */

import fs from 'fs';
import path from 'path';
import { ipcMain, dialog, BrowserWindow, nativeTheme } from 'electron';

// 导入服务
import { toolBridge } from '../services/ToolBridge';
import { storageAdapter } from '../services/StorageAdapter';
import { artifactStore } from '../services/ArtifactStore';
import { agentOrchestrator } from '../services/AgentOrchestrator';
import { llmAdapter } from '../adapters/LLMAdapter';
import { settingsService } from '../services/SettingsService';
import { replayDeviceService } from '../services/ReplayDeviceService';
import { rdxSessionService } from '../index';
import { appPathService } from '../services/AppPathService';
import { runtimeLogService } from '../services/RuntimeLogService';
import { runExecutionService } from '../services/RunExecutionService';
import { conversationService } from '../services/ConversationService';
import { debuggerLlmService } from '../services/DebuggerLlmService';
import { terminalSessionService } from '../services/TerminalSessionService';
import { debuggerRuntime } from '../workflow/debugger/DebuggerRuntime';
import type {
  DebugSessionStartRequest,
  OpenProjectInputRequest,
  ProjectInputRecord,
  RunContextUsageSummary,
  RunSummary,
  SessionAttachmentRecord,
  SessionOutputRecord,
} from '@shared/types/session';
import type { RuntimeLogScope } from '@shared/types/runtimeLog';
import type { TerminalCreateTabRequest } from '@shared/types/terminal';
import type { ConversationSendRequest } from '@shared/types/conversation';
import type { AppSettingsPatch } from '@shared/types/settings';
import type { SessionRecord } from '@shared/types/session';
import type { ActionEvent } from '@shared/types/evidence';
import { registerShellHandlers } from './shellHandlers';

const ACTION_ARTIFACT_KEYS = [
  'artifactPath',
  'artifact_path',
  'filePath',
  'file_path',
  'imagePath',
  'image_path',
  'outputPath',
  'output_path',
  'reportPath',
  'report_path',
  'savedPath',
  'saved_path',
  'path',
];

function inferMimeType(filePath: string): string | undefined {
  const extension = path.extname(filePath).toLowerCase();
  const table: Record<string, string> = {
    '.md': 'text/markdown',
    '.txt': 'text/plain',
    '.log': 'text/plain',
    '.json': 'application/json',
    '.html': 'text/html',
    '.htm': 'text/html',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.csv': 'text/csv',
  };
  return table[extension];
}

function readFileTimestamps(filePath: string): Pick<SessionOutputRecord, 'sizeBytes' | 'createdAt' | 'updatedAt'> {
  try {
    if (!fs.existsSync(filePath)) {
      return {};
    }
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      return {};
    }
    return {
      sizeBytes: stat.size,
      createdAt: stat.birthtimeMs,
      updatedAt: stat.mtimeMs,
    };
  } catch {
    return {};
  }
}

function parseTimestamp(value: string | number | undefined): number | undefined {
  if (typeof value === 'number') {
    return value;
  }
  if (!value) {
    return undefined;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function outputKey(filePath: string): string {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function addSessionOutput(
  outputs: SessionOutputRecord[],
  seen: Set<string>,
  output: SessionOutputRecord,
): void {
  const key = outputKey(output.filePath);
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  outputs.push(output);
}

function isLikelyFilePath(value: string): boolean {
  return /[\\/]/.test(value) || /\.(md|txt|log|json|html?|png|jpe?g|webp|gif|csv)$/i.test(value);
}

function collectActionArtifactPaths(value: unknown, results = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectActionArtifactPaths(entry, results));
    return results;
  }

  if (!value || typeof value !== 'object') {
    return results;
  }

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'string' && ACTION_ARTIFACT_KEYS.includes(key) && isLikelyFilePath(entry)) {
      results.add(entry);
      continue;
    }
    if (entry && typeof entry === 'object') {
      collectActionArtifactPaths(entry, results);
    }
  }
  return results;
}

function resolveActionArtifactPath(sessionId: string, runId: string, filePath: string): string {
  if (path.isAbsolute(filePath)) {
    return path.resolve(filePath);
  }
  try {
    return path.resolve(storageAdapter.getRunPath(sessionId, runId), filePath);
  } catch {
    return path.resolve(filePath);
  }
}

async function buildSessionOutputs(sessionId: string, runId?: string): Promise<SessionOutputRecord[]> {
  const outputs: SessionOutputRecord[] = [];
  const seen = new Set<string>();
  const targetRuns = runId
    ? storageAdapter.listRuns(sessionId).filter((run) => run.runId === runId)
    : storageAdapter.listRuns(sessionId);

  for (const attachment of storageAdapter.listSessionAttachments(sessionId)) {
    addSessionOutput(outputs, seen, {
      id: attachment.attachmentId,
      kind: 'attachment',
      title: attachment.fileName,
      fileName: attachment.fileName,
      filePath: attachment.filePath,
      source: 'session attachment',
      mimeType: attachment.mimeType,
      sizeBytes: attachment.size,
      createdAt: attachment.createdAt,
      updatedAt: attachment.createdAt,
    });
  }

  for (const run of targetRuns) {
    const reportEntries = [
      { id: 'markdown', title: 'report.md', filePath: run.reportPaths?.markdownPath },
      { id: 'json', title: 'report.json', filePath: run.reportPaths?.jsonPath },
      { id: 'html', title: 'visual_report.html', filePath: run.reportPaths?.htmlPath },
    ].filter((entry): entry is { id: string; title: string; filePath: string } => Boolean(entry.filePath));

    for (const report of reportEntries) {
      addSessionOutput(outputs, seen, {
        id: `${run.runId}:report:${report.id}`,
        kind: 'report',
        title: report.title,
        fileName: path.basename(report.filePath),
        filePath: report.filePath,
        source: 'run report',
        runId: run.runId,
        mimeType: inferMimeType(report.filePath),
        ...readFileTimestamps(report.filePath),
      });
    }

    for (const artifact of artifactStore.list(sessionId, run.runId)) {
      addSessionOutput(outputs, seen, {
        id: artifact.artifactId,
        kind: 'artifact',
        title: artifact.title || path.basename(artifact.filePath),
        fileName: path.basename(artifact.filePath),
        filePath: artifact.filePath,
        source: 'artifact store',
        runId: artifact.runId,
        mimeType: artifact.mimeType,
        sizeBytes: artifact.sizeBytes,
        createdAt: parseTimestamp(artifact.createdAt),
        updatedAt: parseTimestamp(artifact.updatedAt),
      });
    }
  }

  const targetRunIds = new Set(targetRuns.map((run) => run.runId));
  try {
    const actionEvents = await storageAdapter.readActionChain(sessionId);
    for (const event of actionEvents) {
      if (runId && !targetRunIds.has(event.run_id)) {
        continue;
      }
      const artifactPaths = collectActionArtifactPaths(event.payload);
      for (const artifactPath of artifactPaths) {
        const resolvedPath = resolveActionArtifactPath(sessionId, event.run_id, artifactPath);
        addSessionOutput(outputs, seen, {
          id: `${event.event_id}:${outputKey(resolvedPath)}`,
          kind: 'action_artifact',
          title: path.basename(resolvedPath),
          fileName: path.basename(resolvedPath),
          filePath: resolvedPath,
          source: event.event_type,
          runId: event.run_id,
          mimeType: inferMimeType(resolvedPath),
          createdAt: event.ts_ms,
          updatedAt: event.ts_ms,
          ...readFileTimestamps(resolvedPath),
        });
      }
    }
  } catch {
    // Missing action chain is valid for a new session; the right panel simply shows other sources.
  }

  return outputs.sort((left, right) => (right.updatedAt ?? right.createdAt ?? 0) - (left.updatedAt ?? left.createdAt ?? 0));
}

let currentSessionId: string | null = null;
let currentProjectId: string | null = null;
let currentRunId: string | null = null;
let toolTraceSubscribed = false;

export async function initializeIpcState(): Promise<void> {
  try {
    currentSessionId = await storageAdapter.getCurrentSessionId();
    currentProjectId = storageAdapter.getCurrentProjectId();
    currentRunId = currentSessionId ? storageAdapter.getLatestRun(currentSessionId)?.runId || null : null;
  } catch (error) {
    console.warn('[IPC] Failed to restore current session id:', error);
    currentSessionId = null;
    currentProjectId = null;
    currentRunId = null;
  }

  await debuggerRuntime.recoverInterruptedRuns();
}

/**
 * 广播事件到所有渲染进程窗口
 */
function broadcastToRenderer(channel: string, ...args: unknown[]): void {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, ...args);
    }
  }
}

function broadcastRunStatusChanged(payload: {
  runId: string;
  sessionId: string;
  status: string;
  lastStage?: string;
  stopReason?: string;
}): void {
  broadcastToRenderer('workflow:runStatusChanged', payload);
}

async function appendActionEvent(event: ActionEvent): Promise<void> {
  await storageAdapter.appendActionEvent(event.session_id, event);
  broadcastToRenderer('evidence:eventAdded', event);
}

async function setRunLifecycleState(
  sessionId: string,
  runId: string,
  patch: {
    status: RunSummary['status'];
    lastStage?: string;
    stopReason?: string;
    stoppedAt?: number;
    finishedAt?: number;
  },
): Promise<void> {
  const updatePayload: Record<string, unknown> = {
    status: patch.status,
  };

  if (patch.lastStage) {
    updatePayload.lastStage = patch.lastStage;
    updatePayload.runtime = {
      workflow_stage: patch.lastStage,
    };
  }
  if (patch.stopReason) {
    updatePayload.stopReason = patch.stopReason;
  }
  if (patch.stoppedAt) {
    updatePayload.stoppedAt = patch.stoppedAt;
  }
  if (patch.finishedAt) {
    updatePayload.finishedAt = patch.finishedAt;
  }

  await storageAdapter.updateRun(sessionId, runId, updatePayload);
  broadcastRunStatusChanged({
    runId,
    sessionId,
    status: patch.status,
    lastStage: patch.lastStage,
    stopReason: patch.stopReason,
  });
}

async function selectCurrentProject(projectId: string | null): Promise<{
  project: ReturnType<typeof storageAdapter.getProjectById>;
  currentSession: SessionRecord | null;
  currentRun: RunSummary | null;
}> {
  if (!projectId) {
    currentProjectId = null;
    currentSessionId = null;
    currentRunId = null;
    storageAdapter.setCurrentProjectId(null);
    return {
      project: null,
      currentSession: null,
      currentRun: null,
    };
  }

  const project = storageAdapter.getProjectById(projectId);
  if (!project) {
    return {
      project: null,
      currentSession: null,
      currentRun: null,
    };
  }

  currentProjectId = projectId;
  const selectedSession = currentSessionId ? storageAdapter.readSession(currentSessionId) : null;
  if (!selectedSession || selectedSession.projectId !== projectId) {
    currentSessionId = null;
    currentRunId = null;
    await storageAdapter.setCurrentSessionId(null);
  } else {
    currentRunId = selectedSession.lastRunId || currentRunId;
  }
  storageAdapter.setCurrentProjectId(projectId);

  return {
    project,
    currentSession: selectedSession?.projectId === projectId ? selectedSession : null,
    currentRun: currentSessionId ? storageAdapter.getLatestRun(currentSessionId) : null,
  };
}

/**
 * 注册所有IPC处理�?
 */
export function registerIPCHandlers(): void {
  if (!toolTraceSubscribed) {
    toolBridge.onToolTrace((trace) => {
      broadcastToRenderer('tool:executionComplete', trace);
      if (currentSessionId && currentRunId) {
        void appendActionEvent(storageAdapter.createActionEvent({
          runId: currentRunId,
          sessionId: currentSessionId,
          agentId: trace.runtimeOwner || 'rdc-debugger',
          eventType: 'tool_execution',
          status: trace.result.ok ? 'ok' : 'error',
          turnId: trace.turnId,
          payload: {
            tool_name: trace.toolName,
            args: trace.args,
            result: trace.result.ok ? 'success' : 'failed',
            error: trace.result.error,
            trace_id: trace.traceId,
          },
        }));
      }
      runtimeLogService.log({
        scope: currentSessionId ? 'session' : 'app',
        namespace: 'tool',
        severity: trace.result.ok ? 'success' : 'error',
        title: trace.toolName,
        summary: trace.result.ok
          ? '工具调用已完成。'
          : trace.result.error?.message ?? '工具调用失败。',
        detail: trace.result.duration_ms ? `${trace.result.duration_ms}ms` : undefined,
        sessionId: currentSessionId,
        projectId: currentProjectId,
        runId: currentRunId,
        raw: {
          args: trace.args,
          result: trace.result,
          contextId: trace.contextId,
          runtimeOwner: trace.runtimeOwner,
          ownerLeaseId: trace.ownerLeaseId ?? null,
        },
        timestamp: trace.timestamp,
      });
    });
    toolTraceSubscribed = true;
  }

  // Load persisted LLM config and apply to runtime
  try {
    const llmConfig = settingsService.getLlmConfig();
    llmAdapter.configure(llmConfig);
    agentOrchestrator.applyLlmConfig(llmConfig);
    console.log('[IPC] Loaded persisted LLM config');
  } catch (err) {
    console.warn('[IPC] Failed to preload LLM config:', err);
  }

  registerShellHandlers();

  ipcMain.handle('conversation:sendMessage', async (_event, request: ConversationSendRequest) => {
    const result = await conversationService.sendMessage({
      ...request,
      fallbackProjectId: currentProjectId,
      fallbackSessionId: currentSessionId,
      fallbackRunId: currentRunId,
    });

    if (result.session?.projectId) {
      currentProjectId = result.session.projectId;
    }
    if (result.session?.sessionId) {
      currentSessionId = result.session.sessionId;
      await storageAdapter.setCurrentSessionId(result.session.sessionId);
    }
    if (result.runUpdate?.runId) {
      currentRunId = result.runUpdate.runId;
    }

    return result;
  });

  ipcMain.handle('conversation:getHistory', async (_event, sessionId: string) => {
    if (!sessionId) {
      return { messages: [] };
    }
    return {
      messages: await conversationService.getHistory(sessionId),
    };
  });

  ipcMain.handle('conversation:cancelActiveTurn', async (_event, request?: { sessionId?: string; turnId?: string }) => {
    return conversationService.cancelActiveTurn(request);
  });

  // ========== 工作流操�?==========

  ipcMain.handle('workflow:getState', async () => {
    if (!currentSessionId) {
      return null;
    }

    try {
      return await debuggerRuntime.getWorkflowState(currentSessionId, currentRunId || undefined);
    } catch (error) {
      console.error('[IPC] Failed to get workflow state:', error);
      return null;
    }
  });

  ipcMain.handle('workflow:resume', async (_event, sessionId?: string) => {
    try {
      // 从 storageAdapter 加载指定 session 并恢复 context
      if (sessionId) {
        currentSessionId = sessionId;
        await storageAdapter.setCurrentSessionId(sessionId);
        currentRunId = storageAdapter.getLatestRun(sessionId)?.runId || null;
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('workflow:stop', async (_event, runId?: string) => {
    const targetRunId = runId || currentRunId;
    if (!targetRunId) {
      return { success: false, error: 'No active run.' };
    }
    const result = await debuggerRuntime.stopRun(targetRunId);
    broadcastToRenderer('capture:openedStateChanged', null);
    broadcastToRenderer('context:changed', rdxSessionService.snapshotContext());
    return result;
  });

  ipcMain.handle('workflow:getRunUsage', async (_event, runId?: string) => {
    const targetRunId = runId || currentRunId;
    if (!targetRunId) {
      return { usage: null as RunContextUsageSummary | null };
    }

    return {
      usage: debuggerLlmService.getRunContextUsage(targetRunId),
    };
  });

  ipcMain.handle('workflow:listRuns', async () => {
    if (!currentSessionId) {
      return { runs: [] as RunSummary[] };
    }
    return { runs: storageAdapter.listRuns(currentSessionId) };
  });

  ipcMain.handle('workflow:listActiveRuns', async () => {
    return { runs: runExecutionService.listActiveRuns() };
  });

  ipcMain.handle('project:list', async () => {
    return { projects: storageAdapter.listProjects() };
  });

  ipcMain.handle('project:add', async (_event, rootPath: string) => {
    try {
      const project = storageAdapter.createProject(rootPath);
      await selectCurrentProject(project.projectId);
      return { success: true, project };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('project:select', async (_event, projectId: string) => {
    try {
      const selection = await selectCurrentProject(projectId);
      if (!selection.project) {
        return { success: false, error: `Project not found: ${projectId}` };
      }
      return {
        success: true,
        project: selection.project,
        currentSession: selection.currentSession,
        currentRun: selection.currentRun,
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('project:rename', async (_event, projectId: string, newName: string) => {
    try {
      const project = storageAdapter.renameProject(projectId, newName);
      return { success: true, project };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('project:remove', async (_event, projectId: string) => {
    try {
      storageAdapter.removeProject(projectId);
      if (currentProjectId === projectId) {
        currentProjectId = null;
        currentSessionId = null;
        currentRunId = null;
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('project:inputs:list', async (_event, projectId: string) => {
    return { inputs: storageAdapter.listProjectInputs(projectId) };
  });

  ipcMain.handle('project:inputs:refresh', async (_event, projectId: string) => {
    const inputs = storageAdapter.refreshProjectInputs(projectId);
    broadcastToRenderer('project:inputsChanged', { projectId, inputs });
    return { inputs };
  });

  ipcMain.handle('project:inputs:import', async (_event, projectId: string) => {
    const result = await dialog.showOpenDialog({
      filters: [{ name: 'RenderDoc Capture', extensions: ['rdc'] }],
      properties: ['openFile', 'multiSelections'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { success: true, inputs: storageAdapter.listProjectInputs(projectId) };
    }

    const inputs = storageAdapter.importProjectInputs(projectId, result.filePaths);
    broadcastToRenderer('project:inputsChanged', { projectId, inputs });
    return { success: true, inputs };
  });

  ipcMain.handle('project:inputs:importPaths', async (_event, projectId: string, filePaths: string[]) => {
    try {
      const inputs = storageAdapter.importProjectInputs(projectId, filePaths ?? []);
      broadcastToRenderer('project:inputsChanged', { projectId, inputs });
      return { success: true, inputs };
    } catch (error) {
      return {
        success: false,
        inputs: [] as ProjectInputRecord[],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle('session:list', async (_event, projectId?: string) => {
    const resolvedProjectId = projectId || currentProjectId;
    if (!resolvedProjectId) {
      return { sessions: [] as SessionRecord[] };
    }
    return { sessions: storageAdapter.listSessions(resolvedProjectId) };
  });

  ipcMain.handle('session:create', async (_event, projectId: string, title?: string) => {
    try {
      const session = storageAdapter.createSession(projectId, title);
      currentProjectId = session.projectId;
      currentSessionId = session.sessionId;
      currentRunId = null;
      await storageAdapter.setCurrentSessionId(session.sessionId);
      return { success: true, session };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('session:rename', async (_event, id: string, title: string) => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      return { success: false, error: 'Session 名称不能为空。' };
    }

    const session = storageAdapter.updateSession(id, { title: trimmedTitle });
    if (!session) {
      return { success: false, error: `Session not found: ${id}` };
    }

    return { success: true, session };
  });

  ipcMain.handle('session:remove', async (_event, id: string) => {
    const session = storageAdapter.readSession(id);
    if (!session) {
      return { success: false, error: `Session not found: ${id}` };
    }

    const runs = storageAdapter.listRuns(id);
    const activeRun = runs.find((run) => ['queued', 'running', 'stopping'].includes(run.status));
    if (activeRun) {
      runExecutionService.stopRun(activeRun.runId);
      toolBridge.abortRun(activeRun.runId);
      await setRunLifecycleState(id, activeRun.runId, {
        status: 'cancelled',
        lastStage: activeRun.lastStage,
        stopReason: 'Session removed',
        stoppedAt: Date.now(),
        finishedAt: Date.now(),
      });
    }

    storageAdapter.removeSession(id);
    const remainingSessions = storageAdapter.listSessions(session.projectId);
    const nextSession = remainingSessions[0] || null;
    let nextRun: RunSummary | null = null;
    if (currentSessionId === id) {
      currentSessionId = nextSession?.sessionId || null;
      currentRunId = nextSession?.lastRunId || null;
      currentProjectId = session.projectId;
      if (currentSessionId) {
        await storageAdapter.setCurrentSessionId(currentSessionId);
        nextRun = storageAdapter.getLatestRun(currentSessionId);
      } else {
        await storageAdapter.setCurrentSessionId(null);
        storageAdapter.setCurrentProjectId(session.projectId);
      }
    }

    return { success: true, nextSession, nextRun };
  });

  ipcMain.handle('session:select', async (_event, id: string) => {
    const session = storageAdapter.readSession(id);
    if (!session) {
      return { success: false, error: `Session not found: ${id}` };
    }

    currentSessionId = id;
    currentProjectId = session.projectId;
    currentRunId = session.lastRunId || null;
    await storageAdapter.setCurrentSessionId(id);
    return {
      success: true,
      session,
      currentRun: storageAdapter.getLatestRun(id),
    };
  });

  ipcMain.handle('session:attachments:list', async (_event, sessionId: string) => {
    return {
      attachments: storageAdapter.listSessionAttachments(sessionId),
    };
  });

  ipcMain.handle('session:outputs:list', async (_event, sessionId: string, runId?: string) => {
    if (!sessionId) {
      return { outputs: [] as SessionOutputRecord[] };
    }
    return {
      outputs: await buildSessionOutputs(sessionId, runId),
    };
  });

  ipcMain.handle('session:attachments:import', async (_event, sessionId: string, filePaths: string[]) => {
    try {
      return {
        success: true,
        attachments: storageAdapter.importSessionAttachments(sessionId, filePaths ?? []),
      };
    } catch (error) {
      return {
        success: false,
        attachments: [] as SessionAttachmentRecord[],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle('run:list', async (_event, sessionId: string) => {
    return { runs: storageAdapter.listRuns(sessionId) };
  });

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

  ipcMain.handle('context:get', async () => {
    return rdxSessionService.snapshotContext();
  });

  ipcMain.handle('context:openHumanPreview', async (_event, request?: { sessionId?: string }) => {
    try {
      const contextSnapshot = await rdxSessionService.openHumanPreviewWindow(request);
      broadcastToRenderer('context:changed', contextSnapshot);
      const preview = contextSnapshot.humanPreview;
      return {
        success: preview?.status === 'open' || preview?.status === 'opening',
        contextSnapshot,
        error: preview?.lastError,
      };
    } catch (error) {
      const contextSnapshot = rdxSessionService.snapshotContext();
      return {
        success: false,
        contextSnapshot,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle('context:closeHumanPreview', async () => {
    try {
      const contextSnapshot = await rdxSessionService.closeHumanPreviewWindow();
      broadcastToRenderer('context:changed', contextSnapshot);
      return {
        success: contextSnapshot.humanPreview?.status === 'closed',
        contextSnapshot,
        error: contextSnapshot.humanPreview?.lastError,
      };
    } catch (error) {
      const contextSnapshot = rdxSessionService.snapshotContext();
      return {
        success: false,
        contextSnapshot,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle('capture:list', async () => {
    return { captures: rdxSessionService.getCaptureDescriptors() };
  });

  ipcMain.handle(
    'capture:openProjectInput',
    async (_event, request: Omit<OpenProjectInputRequest, 'replayDevice'> & { replayDeviceId: string }) => {
      try {
        runtimeLogService.log({
          scope: currentSessionId ? 'session' : 'app',
          namespace: 'capture',
          severity: 'info',
          title: 'Open project input',
          summary: `开始打开 ${request.inputId}。`,
          detail: request.filePath,
          sessionId: currentSessionId,
          projectId: request.projectId,
          runId: currentRunId,
          raw: {
            inputId: request.inputId,
            replayDeviceId: request.replayDeviceId,
            filePath: request.filePath,
          },
        });
        const input = storageAdapter.listProjectInputs(request.projectId)
          .find((entry) => entry.inputId === request.inputId && entry.filePath === request.filePath);
        if (!input) {
          return { success: false, error: `Project input not found: ${request.inputId}` };
        }

        const replayDevice = replayDeviceService.getDeviceById(request.replayDeviceId);
        if (!replayDevice) {
          return { success: false, error: `Replay device not found: ${request.replayDeviceId}` };
        }

        const openedCapture = await rdxSessionService.openProjectInput({
          projectId: request.projectId,
          inputId: input.inputId,
          filePath: input.filePath,
          replayDevice,
        });
        const contextSnapshot = rdxSessionService.snapshotContext();
        broadcastToRenderer('capture:openedStateChanged', openedCapture);
        broadcastToRenderer('context:changed', contextSnapshot);
        runtimeLogService.log({
          scope: currentSessionId ? 'session' : 'app',
          namespace: 'capture',
          severity: 'success',
          title: 'Project input opened',
          summary: `${input.fileName} 已打开。`,
          detail: openedCapture.preview?.source === 'framebuffer_screenshot'
            ? '预览来源：framebuffer'
            : openedCapture.preview?.source === 'capture_thumbnail'
              ? '预览来源：thumbnail'
              : openedCapture.previewError?.code
                ? `当前无可用预览：${openedCapture.previewError.code}`
                : '当前无可用预览',
          sessionId: currentSessionId,
          projectId: request.projectId,
          runId: currentRunId,
          raw: {
            openedCapture,
            contextSnapshot,
          },
        });
        return { success: true, openedCapture, contextSnapshot };
      } catch (err) {
        runtimeLogService.log({
          scope: currentSessionId ? 'session' : 'app',
          namespace: 'capture',
          severity: 'error',
          title: 'Project input open failed',
          summary: err instanceof Error ? err.message : String(err),
          sessionId: currentSessionId,
          projectId: request.projectId,
          runId: currentRunId,
          raw: {
            inputId: request.inputId,
            replayDeviceId: request.replayDeviceId,
            filePath: request.filePath,
          },
        });
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle('capture:getOpenedState', async () => {
    return rdxSessionService.snapshotOpenedCapture();
  });

  ipcMain.handle('capture:clearOpenedState', async () => {
    await rdxSessionService.closeOrReplaceOpenedCapture();
    broadcastToRenderer('capture:openedStateChanged', null);
    broadcastToRenderer('context:changed', rdxSessionService.snapshotContext());
    runtimeLogService.log({
      scope: currentSessionId ? 'session' : 'app',
      namespace: 'capture',
      severity: 'info',
      title: 'Opened capture cleared',
      summary: '当前打开的 capture 已清理。',
      sessionId: currentSessionId,
      projectId: currentProjectId,
      runId: currentRunId,
    });
    return { success: true };
  });

  ipcMain.handle('capture:select', async (_event, captureId: string) => {
    try {
      await rdxSessionService.switchActiveCapture(captureId);
      broadcastToRenderer('capture:statusChanged', { captureId, status: 'selected' });
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('workflow:start', async (_event, request: DebugSessionStartRequest) => {
    const result = await debuggerRuntime.startPlan(request);
    if (result.success) {
      currentSessionId = result.sessionId || currentSessionId;
      currentRunId = result.runId || currentRunId;
      currentProjectId = request.projectId;
      if (currentSessionId) {
        await storageAdapter.setCurrentSessionId(currentSessionId);
      }
    }
    return result;
  });

  ipcMain.handle('workflow:getPlan', async (_event, runId: string) => {
    return debuggerRuntime.getPlan(runId);
  });

  ipcMain.handle('workflow:submitQuestions', async (_event, runId: string, answers: unknown[]) => {
    return debuggerRuntime.submitQuestions(runId, answers as import('@shared/types/workflow').AskUserAnswer[]);
  });

  ipcMain.handle('workflow:approvePlan', async (_event, runId: string) => {
    return debuggerRuntime.approvePlan(runId);
  });

  ipcMain.handle('workflow:restartRun', async (_event, runId: string) => {
    const result = await debuggerRuntime.restartRun(runId);
    if (result.success) {
      currentSessionId = result.sessionId || currentSessionId;
      currentRunId = result.runId || currentRunId;
      if (currentSessionId) {
        await storageAdapter.setCurrentSessionId(currentSessionId);
      }
    }
    return result;
  });

  // ========== Agent操作 ==========

  ipcMain.handle('agent:sendMessage', async (_event, agentId: string, content: string) => {
    try {
      let context: { caseId?: string; runId?: string; sessionId?: string } | undefined;

      if (currentSessionId) {
        const currentRun = currentRunId
          ? storageAdapter.listRuns(currentSessionId).find((run) => run.runId === currentRunId)
          : storageAdapter.getLatestRun(currentSessionId);
        if (currentRun) {
          context = {
            caseId: currentRun.caseId,
            runId: currentRun.runId,
            sessionId: currentRun.sessionId,
          };
        }
      }
      
      const response = await agentOrchestrator.sendMessage(agentId as any, content, context, {
        signal: (context?.runId ? runExecutionService.getAbortSignal(context.runId) : null) ?? undefined,
      });
      return { response };
    } catch (error) {
      return {
        response: undefined,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle('agent:getState', async (_event, agentId: string) => {
    return agentOrchestrator.getAgentState(agentId as any);
  });

  ipcMain.handle('agent:getAllStates', async () => {
    return agentOrchestrator.getAllAgentStates();
  });

  ipcMain.handle('agent:configure', async (_event, agentId: string, config: unknown) => {
    try {
      agentOrchestrator.configureAgent(agentId as any, config as any);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // ========== 工具操作 ==========

  ipcMain.handle('tool:getCatalog', async () => {
    try {
      return await toolBridge.loadCatalog();
    } catch {
      return { tools: [], namespaces: {} };
    }
  });

  ipcMain.handle('tool:getRuntimeSummary', async () => {
    return toolBridge.getRuntimeSummary();
  });

  ipcMain.handle('tool:execute', async (_event, toolName: string, args: unknown) => {
    return toolBridge.call({
      toolName,
      args: args as Record<string, unknown>,
    });
  });

  // ========== 证据链操�?==========

  ipcMain.handle('evidence:getChain', async () => {
    const sessionId = await storageAdapter.getCurrentSessionId();
    if (!sessionId) {
      return { sessionId: '', runId: '', events: [], isValid: true };
    }

    const events = await storageAdapter.readActionChain(sessionId);

    return {
      sessionId,
      runId: currentRunId || storageAdapter.getLatestRun(sessionId)?.runId || '',
      events,
      isValid: true,
    };
  });

  ipcMain.handle('evidence:getEvents', async (_event, eventType?: string) => {
    const sessionId = await storageAdapter.getCurrentSessionId();
    if (!sessionId) return [];

    const events = await storageAdapter.readActionChain(sessionId);
    if (eventType) {
      return events.filter(e => e.event_type === eventType);
    }
    return events;
  });

  // ========== LLM操作 ==========

  ipcMain.handle('llm:configure', async (_event, config: unknown) => {
    llmAdapter.configure(config as any);
    return;
  });

  ipcMain.handle('llm:testConnection', async (_event, provider: string) => {
    return llmAdapter.testConnection(provider);
  });

  ipcMain.handle('llm:getAvailableModels', async (_event, provider: string) => {
    return llmAdapter.getAvailableModels(provider);
  });

  // ========== 设置操作 ==========

  ipcMain.handle('settings:get', async () => {
    const paths = appPathService.getWorkspacePaths();
    return settingsService.getAll({
      workspaceRoot: paths.workspaceRoot,
      defaultWorkspaceRoot: paths.defaultWorkspaceRoot,
      settingsPath: paths.settingsPath,
      logsPath: paths.logsPath,
      logPath: paths.logPath,
      projectsPath: paths.projectsPath,
      knowledgePath: paths.knowledgePath,
      migrationOrphansPath: paths.migrationOrphansPath,
      profilesPath: paths.profilesPath,
      policiesPath: paths.policiesPath,
      secretsPath: paths.secretsPath,
      migrationReportsPath: paths.migrationReportsPath,
    });
  });

  ipcMain.handle('settings:getProviderSecret', async (_event, providerId: string) => {
    const paths = appPathService.getWorkspacePaths();
    return settingsService.getProviderSecret(providerId, paths.workspaceRoot);
  });

  ipcMain.handle('settings:set', async (_event, settings: unknown) => {
    const nextSettings = settingsService.setAll(settings as AppSettingsPatch, appPathService.getWorkspacePaths());
    storageAdapter.setWorkspaceRoot(nextSettings.workspace.rootPath);
    await storageAdapter.initializeWorkspace();
    await initializeIpcState();
    const llmConfig = settingsService.getLlmConfig();
    llmAdapter.configure(llmConfig);
    agentOrchestrator.applyLlmConfig(llmConfig);
    return nextSettings;
  });

  // ========== 设备操作 ==========

  ipcMain.handle('device:list', async () => {
    return replayDeviceService.listDevices();
  });

  ipcMain.handle('device:refresh', async () => {
    return replayDeviceService.refreshDevices();
  });

  ipcMain.handle('device:activate', async (_event, deviceId: string) => {
    return replayDeviceService.activateDevice(deviceId);
  });

  nativeTheme.on('updated', () => {
    broadcastToRenderer('app:themeChanged', nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
  });
}

/**
 * 设置主窗口引用（用于通知UI）
 */
export function setMainWindow(window: BrowserWindow): void {
  replayDeviceService.setMainWindow(window);
  agentOrchestrator.setMainWindow(window);
}

export async function stopAllActiveRuns(): Promise<void> {
  await runExecutionService.stopAll();
}

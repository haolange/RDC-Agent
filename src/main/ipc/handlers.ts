/**
 * IPC Handlers - 注册所有IPC处理�?
 */

import fs from 'fs';
import { app, ipcMain, dialog, BrowserWindow, clipboard, nativeTheme, shell } from 'electron';
import { Command } from '@langchain/langgraph';

// 导入服务
import { toolBridge } from '../services/ToolBridge';
import { storageAdapter } from '../services/StorageAdapter';
// import { workflowEngine } from '../services/WorkflowEngine'; // 已迁移到 WorkflowGraph
import { harnessController } from '../services/HarnessController';
import { agentOrchestrator } from '../services/AgentOrchestrator';
import { llmAdapter } from '../adapters/LLMAdapter';
import { settingsService } from '../services/SettingsService';
import { replayDeviceService } from '../services/ReplayDeviceService';
import { rdxSessionService } from '../index';
import { appPathService } from '../services/AppPathService';
import { runtimeLogService } from '../services/RuntimeLogService';
import { runExecutionService } from '../services/RunExecutionService';
import type { DebugSessionStartRequest, OpenProjectInputRequest, RunSummary } from '@shared/types/session';
import type { RuntimeLogScope } from '@shared/types/runtimeLog';

// WorkflowGraph 相关导入
import { createWorkflowGraph } from '../services/WorkflowGraph';
import { projectToWorkflowState } from '../services/NodeFunctions/utils';
import { FileCheckpointSaver } from '../services/CheckpointSaver';
import type { WorkflowStateType } from '../services/WorkflowGraph';
import type { AppSettingsPatch } from '@shared/types/settings';
import type { SessionRecord } from '@shared/types/session';
import type { ActionEvent } from '@shared/types/evidence';

// 模块级变�?
let compiledGraph: ReturnType<typeof createWorkflowGraph> | null = null;
let checkpointSaver: FileCheckpointSaver | null = null;
let currentSessionId: string | null = null;
let currentProjectId: string | null = null;
let currentRunId: string | null = null;
let mainWindow: BrowserWindow | null = null;
let toolTraceSubscribed = false;

/**
 * 初始�?WorkflowGraph
 * �?index.ts 调用
 */
export async function initWorkflowGraph(workspacePath: string): Promise<void> {
  checkpointSaver = new FileCheckpointSaver(workspacePath);
  compiledGraph = createWorkflowGraph({ checkpointer: checkpointSaver });

  try {
    currentSessionId = await storageAdapter.getCurrentSessionId();
    currentProjectId = storageAdapter.getCurrentProjectId();
  } catch (error) {
    console.warn('[IPC] Failed to restore current session id:', error);
    currentSessionId = null;
    currentProjectId = null;
  }

  await recoverInterruptedRuns();
}

/**
 * 获取当前 thread_id (使用 sessionId)
 */
function getThreadId(): string {
  return currentSessionId || 'default-thread';
}

function getGraphConfig(): { configurable: { thread_id: string; checkpoint_ns?: string } } {
  return {
    configurable: {
      thread_id: getThreadId(),
      checkpoint_ns: currentRunId || undefined,
    },
  };
}

/**
 * 检�?graph 是否已初始化
 */
function ensureGraphInitialized(): boolean {
  if (!compiledGraph) {
    console.error('[IPC] WorkflowGraph not initialized');
    return false;
  }
  return true;
}

/**
 * 通知渲染层状态变�?
 */
function notifyWorkflowStateChanged(graphState: WorkflowStateType): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const workflowState = projectToWorkflowState(graphState as unknown as import('../../shared/types/workflow').GraphState);
    mainWindow.webContents.send('workflow:stateChanged', workflowState);
    mainWindow.webContents.send('workflow:stageChanged', {
      stage: graphState.currentStage,
      blockers: graphState.blockers,
    });
  }
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
  broadcastToRenderer('workflow:stateChanged', payload);
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

async function recoverInterruptedRuns(): Promise<void> {
  const projects = storageAdapter.listProjects();
  for (const project of projects) {
    const sessions = storageAdapter.listSessions(project.projectId);
    for (const session of sessions) {
      const runs = storageAdapter.listRuns(session.sessionId);
      for (const run of runs) {
        if (!['running', 'queued', 'stopping'].includes(run.status)) {
          continue;
        }
        if (runExecutionService.listActiveRuns().some((active) => active.runId === run.runId)) {
          continue;
        }
        await storageAdapter.updateRun(session.sessionId, run.runId, {
          status: 'interrupted',
          stopReason: 'Recovered after app restart',
          stoppedAt: Date.now(),
          finishedAt: Date.now(),
        });
      }
    }
  }
}

/**
 * 检查是否是 interrupt 结果
 */
function isInterrupted(result: unknown): result is { __interrupt__: unknown[] } {
  return result !== null && 
         typeof result === 'object' && 
         '__interrupt__' in result && 
         Array.isArray((result as Record<string, unknown>).__interrupt__);
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

  // ========== 对话框操�?==========

  ipcMain.handle('dialog:selectRdcFiles', async () => {
    const result = await dialog.showOpenDialog({
      filters: [{ name: 'RenderDoc Capture', extensions: ['rdc'] }],
      properties: ['openFile', 'multiSelections'],
    });
    return result.canceled ? null : result.filePaths;
  });

  ipcMain.handle('dialog:selectDirectory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('window:minimize', async (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.handle('window:toggleMaximize', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return false;

    if (window.isMaximized()) {
      window.unmaximize();
      return false;
    }

    window.maximize();
    return true;
  });

  ipcMain.handle('window:close', async (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  ipcMain.handle('window:isMaximized', async (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false;
  });

  ipcMain.handle('app:getMeta', async () => {
    return {
      version: app.getVersion(),
      productName: app.getName(),
      systemTheme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
    };
  });

  ipcMain.handle('app:selectAvatar', async () => {
    const result = await dialog.showOpenDialog({
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
      properties: ['openFile'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('app:openPath', async (_event, targetPath: string) => {
    if (!targetPath) return { success: false, error: 'path is required' };
    try {
      const stats = fs.existsSync(targetPath) ? fs.statSync(targetPath) : null;
      if (stats?.isDirectory()) {
        await shell.openPath(targetPath);
      } else {
        shell.showItemInFolder(targetPath);
      }
    } catch {
      shell.showItemInFolder(targetPath);
    }
    return { success: true };
  });

  ipcMain.handle('app:copyText', async (_event, text: string) => {
    clipboard.writeText(text ?? '');
    return { success: true };
  });

  // ========== 工作流操�?==========

  ipcMain.handle('workflow:getState', async () => {
    if (!ensureGraphInitialized()) {
      return null;
    }

    try {
      // �?checkpoint 获取最新状�?
      const config = getGraphConfig();
      const state = await compiledGraph!.getState(config);
      
      if (state && state.values) {
        return projectToWorkflowState(state.values as unknown as import('../../shared/types/workflow').GraphState);
      }
      return null;
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
    const sessionId = currentSessionId;
    if (!targetRunId || !sessionId) {
      return { success: false, error: 'No active run.' };
    }

    const targetRun = storageAdapter.listRuns(sessionId).find((run) => run.runId === targetRunId);
    if (!targetRun) {
      return { success: false, error: `Run not found: ${targetRunId}` };
    }

    await setRunLifecycleState(sessionId, targetRunId, {
      status: 'stopping',
      lastStage: targetRun.lastStage,
      stopReason: 'Stopping requested',
      stoppedAt: Date.now(),
    });

    const stopIssued = runExecutionService.stopRun(targetRunId);
    toolBridge.abortRun(targetRunId);
    await rdxSessionService.closeOrReplaceOpenedCapture();
    broadcastToRenderer('capture:openedStateChanged', null);
    broadcastToRenderer('context:changed', rdxSessionService.snapshotContext());

    if (!stopIssued) {
      await setRunLifecycleState(sessionId, targetRunId, {
        status: 'cancelled',
        lastStage: targetRun.lastStage,
        stopReason: 'Stopped without active controller',
        stoppedAt: Date.now(),
        finishedAt: Date.now(),
      });
    }

    return { success: true };
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
      currentProjectId = project.projectId;
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
    if (currentSessionId === id) {
      currentSessionId = null;
      currentRunId = null;
    }

    return { success: true };
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

  ipcMain.handle('run:list', async (_event, sessionId: string) => {
    return { runs: storageAdapter.listRuns(sessionId) };
  });

  ipcMain.handle('runtimeLog:list', async (_event, request: { scope: RuntimeLogScope; sessionId?: string | null }) => {
    return {
      entries: runtimeLogService.list(request.scope, request.sessionId),
    };
  });

  ipcMain.handle('context:get', async () => {
    return rdxSessionService.snapshotContext();
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
    const capturePaths = request.captures.map((capture) => capture.filePath);
    const goal = request.goal;

    try {
      if (!ensureGraphInitialized()) {
        return {
          success: false,
          error: 'WorkflowGraph not initialized',
        };
      }

      const gateResult = await harnessController.executeEntryGate({
        capturePaths,
        platform: 'rdc-agent',
        entryMode: 'cli',
        backend: request.captures.some((capture) => capture.backendHint === 'remote') ? 'remote' : 'local',
        mode: request.mode,
        captures: request.captures,
        replayDevice: request.replayDevice,
      });

      if (gateResult.status === 'blocked') {
        return {
          success: false,
          error: gateResult.blockers.map(b => b.reason).join('; '),
        };
      }

      const caseId = request.sessionId || await storageAdapter.createCase({
        projectId: request.projectId,
        userGoal: goal,
        symptomSummary: goal,
      });

      const { runId, sessionId } = await storageAdapter.createRun({
        caseId,
        capturePaths,
        mode: request.mode,
        goal,
        captures: request.captures,
        backend: request.captures.some((capture) => capture.backendHint === 'remote') ? 'remote' : 'local',
        status: 'queued',
      });

      currentSessionId = sessionId;
      currentRunId = runId;
      currentProjectId = request.projectId;
      await storageAdapter.setCurrentSessionId(sessionId);
      await appendActionEvent(storageAdapter.createActionEvent({
        runId,
        sessionId,
        agentId: 'rdc-debugger',
        eventType: 'system',
        status: 'ok',
        payload: {
          message: 'Run queued',
          goal,
          mode: request.mode,
        },
      }));

      broadcastRunStatusChanged({
        runId,
        sessionId,
        status: 'queued',
        lastStage: 'preflight',
      });

      runExecutionService.startRun(
        {
          runId,
          sessionId,
          projectId: request.projectId,
        },
        async (signal) => {
          let contextSnapshot: import('@shared/types/session').ContextSnapshot | undefined;
          try {
            await setRunLifecycleState(sessionId, runId, {
              status: 'running',
              lastStage: 'preflight',
            });

            contextSnapshot = await rdxSessionService.bootstrap(request);
            if (signal.aborted) {
              throw new Error(`Run aborted: ${runId}`);
            }

            broadcastToRenderer('context:changed', contextSnapshot);
            broadcastToRenderer('capture:openedStateChanged', rdxSessionService.snapshotOpenedCapture());

            await storageAdapter.updateRun(sessionId, runId, {
              runtime: {
                context_id: contextSnapshot.contextId,
                runtime_owner: contextSnapshot.runtimeOwner,
                session_id: sessionId,
              },
            });

            const config = getGraphConfig();
            const initialState: Partial<WorkflowStateType> = {
              caseId,
              runId,
              sessionId,
              userGoal: goal,
              capturePaths,
              currentStage: 'preflight' as const,
              stageHistory: [],
              evidenceChain: [],
              artifacts: [],
              activeSpecialists: {},
              pendingBriefs: [],
              collectedBriefs: {},
              blockers: [],
              backtrackCount: {},
              fixVerified: false,
              entryMode: 'cli' as const,
              backend: request.captures.some((capture) => capture.backendHint === 'remote') ? 'remote' as const : 'local' as const,
              mode: request.mode,
              goal,
              captures: request.captures,
              primaryCaptureId: request.primaryCaptureId,
              replayDevice: request.replayDevice,
              orchestrationMode: 'multi_agent' as const,
              coordinationMode: 'staged_handoff' as const,
              lastUpdated: new Date().toISOString(),
            };

            const result = await compiledGraph!.invoke(initialState, config);
            if (signal.aborted) {
              throw new Error(`Run aborted: ${runId}`);
            }

            if (isInterrupted(result)) {
              const interruptData = result.__interrupt__[0];
              await setRunLifecycleState(sessionId, runId, {
                status: 'interrupted',
                lastStage: (interruptData as Record<string, unknown>)?.currentStage as string | undefined || 'blocked',
                stopReason: String((interruptData as Record<string, unknown>)?.type || 'Workflow interrupted'),
                stoppedAt: Date.now(),
                finishedAt: Date.now(),
              });

              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('workflow:blocked', {
                  type: (interruptData as Record<string, unknown>)?.type || 'unknown',
                  data: interruptData,
                });
              }
              return;
            }

            notifyWorkflowStateChanged(result);
            await setRunLifecycleState(sessionId, runId, {
              status: 'completed',
              lastStage: result.currentStage,
              finishedAt: Date.now(),
            });
          } catch (error) {
            const aborted = signal.aborted;
            await setRunLifecycleState(sessionId, runId, {
              status: aborted ? 'cancelled' : 'failed',
              lastStage: 'blocked',
              stopReason: aborted
                ? 'Stopped by user'
                : (error instanceof Error ? error.message : String(error)),
              stoppedAt: Date.now(),
              finishedAt: Date.now(),
            });

            runtimeLogService.log({
              scope: 'session',
              namespace: 'system',
              severity: aborted ? 'warning' : 'error',
              title: aborted ? 'Run stopped' : 'Run failed',
              summary: aborted
                ? '调试任务已停止。'
                : (error instanceof Error ? error.message : String(error)),
              sessionId,
              projectId: request.projectId,
              runId,
            });
          }
        },
      );

      return { success: true, caseId, runId, sessionId, status: 'queued' };
    } catch (error) {
      console.error('Failed to start workflow:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle('workflow:advanceStage', async () => {
    if (!ensureGraphInitialized()) {
      return {
        success: false,
        error: 'WorkflowGraph not initialized',
      };
    }

    try {
      // 使用 Command.resume �?checkpoint 恢复继续执行
      const config = getGraphConfig();
      
      // 发�?resume 命令继续执行
      const result = await compiledGraph!.invoke(
        new Command({ resume: { action: 'advance' } }),
        config
      );

      // 检查是否被中断
      if (isInterrupted(result)) {
        const interruptData = result.__interrupt__[0];
        return {
          success: false,
          currentStage: (interruptData as Record<string, unknown>)?.currentStage,
          error: `Workflow blocked: ${(interruptData as Record<string, unknown>)?.message || 'Unknown reason'}`,
        };
      }

      // 通知状态变�?
      notifyWorkflowStateChanged(result);

      return {
        success: true,
        currentStage: result.currentStage,
      };
    } catch (error) {
      console.error('[IPC] Failed to advance stage:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle('workflow:backtrack', async (_event, reason: string, trigger: string) => {
    if (!ensureGraphInitialized()) {
      return {
        success: false,
        error: 'WorkflowGraph not initialized',
      };
    }

    try {
      // 使用 Command.resume �?backtrack 上下文恢�?
      const config = getGraphConfig();
      
      const result = await compiledGraph!.invoke(
        new Command({ 
          resume: { 
            action: 'backtrack',
            reason,
            trigger,
          } 
        }),
        config
      );

      // 检查是否被中断
      if (isInterrupted(result)) {
        const interruptData = result.__interrupt__[0];
        return {
          success: false,
          error: `Backtrack blocked: ${(interruptData as Record<string, unknown>)?.message || 'Unknown reason'}`,
        };
      }

      // 通知状态变�?
      notifyWorkflowStateChanged(result);

      return {
        success: true,
      };
    } catch (error) {
      console.error('[IPC] Failed to backtrack:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle('workflow:dispatchSpecialist', async (_event, agentId: string, objective: string) => {
    if (!ensureGraphInitialized()) {
      return { success: false, error: 'WorkflowGraph not initialized' };
    }

    try {
      // 获取当前状�?
      const config = getGraphConfig();
      const currentState = await compiledGraph!.getState(config);
      
      if (!currentState || !currentState.values) {
        return { success: false, error: 'No active workflow' };
      }

      const state = currentState.values as unknown as WorkflowStateType;

      // 使用 Command 触发 specialist dispatch
      const result = await compiledGraph!.invoke(
        new Command({ 
          resume: { 
            action: 'dispatchSpecialist',
            agentId,
            objective,
          } 
        }),
        config
      );

      // 检查是否被中断
      if (isInterrupted(result)) {
        const interruptData = result.__interrupt__[0];
        return {
          success: false,
          error: `Dispatch blocked: ${(interruptData as Record<string, unknown>)?.message || 'Unknown reason'}`,
        };
      }

      // 通知状态变�?
      notifyWorkflowStateChanged(result);

      // 同时调用 agentOrchestrator 保持兼容�?
      return agentOrchestrator.dispatchSpecialist(agentId as any, objective, {
        caseId: state.caseId,
        runId: state.runId,
        sessionId: state.sessionId,
      });
    } catch (error) {
      console.error('[IPC] Failed to dispatch specialist:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // ========== Agent操作 ==========

  ipcMain.handle('agent:sendMessage', async (_event, agentId: string, content: string) => {
    try {
      // �?WorkflowGraph 获取状�?
      let context: { caseId?: string; runId?: string; sessionId?: string } | undefined;
      
      if (compiledGraph && currentSessionId) {
        const config = getGraphConfig();
        const state = await compiledGraph.getState(config);
        if (state && state.values) {
          const values = state.values as unknown as WorkflowStateType;
          context = {
            caseId: values.caseId,
            runId: values.runId,
            sessionId: values.sessionId,
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
    await initWorkflowGraph(storageAdapter.getWorkspacePath());
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
  mainWindow = window;
  replayDeviceService.setMainWindow(window);
  // workflowEngine.setMainWindow(window); // 已迁移到 WorkflowGraph
  agentOrchestrator.setMainWindow(window);
}

export async function stopAllActiveRuns(): Promise<void> {
  await runExecutionService.stopAll();
}





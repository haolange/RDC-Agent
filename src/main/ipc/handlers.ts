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
import type { DebugSessionStartRequest, OpenProjectInputRequest, RunSummary } from '@shared/types/session';

// WorkflowGraph 相关导入
import { createWorkflowGraph } from '../services/WorkflowGraph';
import { projectToWorkflowState } from '../services/NodeFunctions/utils';
import { FileCheckpointSaver } from '../services/CheckpointSaver';
import type { WorkflowStateType } from '../services/WorkflowGraph';
import type { AppSettingsPatch } from '@shared/types/settings';
import type { SessionRecord } from '@shared/types/session';

// 模块级变�?
let compiledGraph: ReturnType<typeof createWorkflowGraph> | null = null;
let checkpointSaver: FileCheckpointSaver | null = null;
let currentSessionId: string | null = null;
let currentProjectId: string | null = null;
let currentRunId: string | null = null;
let mainWindow: BrowserWindow | null = null;

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

  ipcMain.handle('workflow:listRuns', async () => {
    if (!currentSessionId) {
      return { runs: [] as RunSummary[] };
    }
    return { runs: storageAdapter.listRuns(currentSessionId) };
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

  ipcMain.handle('context:get', async () => {
    return rdxSessionService.snapshotContext();
  });

  ipcMain.handle('capture:list', async () => {
    return { captures: rdxSessionService.getCaptureDescriptors() };
  });

  ipcMain.handle('capture:open', async (_event, filePath?: string) => {
    try {
      if (!filePath) {
        return { success: false, error: 'filePath is required for capture:open' };
      }
      // TODO: 实现增量 capture 导入逻辑
      return { success: false, error: 'capture:open is not yet implemented' };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(
    'capture:openProjectInput',
    async (_event, request: Omit<OpenProjectInputRequest, 'replayDevice'> & { replayDeviceId: string }) => {
      try {
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
        return { success: true, openedCapture, contextSnapshot };
      } catch (err) {
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

  ipcMain.handle('workflow:start', async (_event, request: DebugSessionStartRequest | string[], userGoal?: string) => {
    // 兼容新的 DebugSessionStartRequest 结构和旧的 (capturePaths, userGoal) 签名
    const isNewRequest = !Array.isArray(request);
    const capturePaths = isNewRequest
      ? request.captures.map(c => c.filePath)
      : (request as string[]);
    const goal = isNewRequest ? request.goal : (userGoal ?? '');

    try {
      if (!ensureGraphInitialized()) {
        return {
          success: false,
          error: 'WorkflowGraph not initialized',
        };
      }

      // 若为新请求，先执行 rdxSessionService bootstrap
      let contextSnapshot: import('@shared/types/session').ContextSnapshot | undefined;
      if (isNewRequest) {
        try {
          contextSnapshot = await rdxSessionService.bootstrap(request);
          broadcastToRenderer('context:changed', contextSnapshot);
          broadcastToRenderer('capture:openedStateChanged', rdxSessionService.snapshotOpenedCapture());
        } catch (bootstrapErr) {
          const message = bootstrapErr instanceof Error ? bootstrapErr.message : String(bootstrapErr);
          console.warn('[IPC] rdxSessionService bootstrap failed:', bootstrapErr);
          return {
            success: false,
            error: message,
          };
        }
      }

      // 执行entry gate
      const gateResult = await harnessController.executeEntryGate({
        capturePaths,
        platform: 'rdc-agent',
        entryMode: 'cli',
        backend: isNewRequest
          ? (request.captures.some((c: any) => c.backendHint === 'remote') ? 'remote' : 'local')
          : 'local',
        mode: isNewRequest ? request.mode : 'debugger',
        captures: isNewRequest ? request.captures : undefined,
        replayDevice: isNewRequest ? request.replayDevice : undefined,
      });

      if (gateResult.status === 'blocked') {
        return {
          success: false,
          error: gateResult.blockers.map(b => b.reason).join('; '),
        };
      }

      // 创建case和run
      let caseId: string;
      if (isNewRequest) {
        caseId = request.sessionId || await storageAdapter.createCase({
          projectId: request.projectId,
          userGoal: goal,
          symptomSummary: goal,
        });
      } else {
        const projectId = currentProjectId || storageAdapter.getCurrentProjectId();
        if (!projectId) {
          return {
            success: false,
            error: 'Project is required before starting a workflow.',
          };
        }

        caseId = await storageAdapter.createCase({
          projectId,
          userGoal: goal,
          symptomSummary: goal,
        });
      }

      const { runId, sessionId } = await storageAdapter.createRun({
        caseId,
        capturePaths,
        mode: isNewRequest ? request.mode : 'debugger',
        goal,
        captures: isNewRequest ? request.captures : undefined,
        backend: isNewRequest
          ? (request.captures.some((capture) => capture.backendHint === 'remote') ? 'remote' : 'local')
          : 'local',
      });

      // 设置当前 sessionId 作为 thread_id
      currentSessionId = sessionId;
      currentRunId = runId;
      if (isNewRequest) {
        currentProjectId = request.projectId;
      }
      await storageAdapter.setCurrentSessionId(sessionId);
      if (contextSnapshot) {
        await storageAdapter.updateRun(sessionId, runId, {
          runtime: {
            context_id: contextSnapshot.contextId,
            runtime_owner: contextSnapshot.runtimeOwner,
            session_id: sessionId,
          },
        });
      }

      // 使用 graph.invoke() 启动工作�?
      const config = getGraphConfig();
      
      const initialState = {
        caseId,
        runId,
        sessionId,
        userGoal: goal,
        capturePaths,
        currentStage: 'preflight_pending' as const,
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
        backend: isNewRequest
          ? (request.captures.some((capture) => capture.backendHint === 'remote') ? 'remote' as const : 'local' as const)
          : 'local' as const,
        mode: isNewRequest ? request.mode : 'debugger',
        goal,
        captures: isNewRequest ? request.captures : [],
        primaryCaptureId: isNewRequest ? request.primaryCaptureId : '',
        replayDevice: isNewRequest ? request.replayDevice : null,
        orchestrationMode: 'multi_agent' as const,
        coordinationMode: 'staged_handoff' as const,
        lastUpdated: new Date().toISOString(),
      };

      const result = await compiledGraph!.invoke(initialState, config);

      // 检查是否被中断
      if (isInterrupted(result)) {
        const interruptData = result.__interrupt__[0];
        console.log('[IPC] Workflow interrupted:', interruptData);
        
        // 通知渲染层阻断状�?
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('workflow:blocked', {
            type: (interruptData as Record<string, unknown>)?.type || 'unknown',
            data: interruptData,
          });
        }
      } else {
        // 正常完成，通知状态变�?
        notifyWorkflowStateChanged(result);
      }

      return { success: true, caseId, runId, sessionId, contextSnapshot };
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
      
      const response = await agentOrchestrator.sendMessage(agentId as any, content, context);
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
    });
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





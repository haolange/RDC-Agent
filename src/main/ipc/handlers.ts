/**
 * IPC Handlers - 注册所有IPC处理器
 */

import { app, ipcMain, dialog, BrowserWindow } from 'electron';

// 导入服务
import { toolBridge } from '../services/ToolBridge';
import { storageAdapter } from '../services/StorageAdapter';
import { workflowEngine } from '../services/WorkflowEngine';
import { harnessController } from '../services/HarnessController';
import { agentOrchestrator } from '../services/AgentOrchestrator';
import { llmAdapter } from '../adapters/LLMAdapter';

/**
 * 注册所有IPC处理器
 */
export function registerIPCHandlers(): void {
  // 初始化存储
  storageAdapter.initializeWorkspace().catch(console.error);

  // ========== 对话框操作 ==========

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
    };
  });

  // ========== 工作流操作 ==========

  ipcMain.handle('workflow:getState', async () => {
    return workflowEngine.getState();
  });

  ipcMain.handle('workflow:start', async (_event, capturePaths: string[], userGoal: string) => {
    try {
      // 执行entry gate
      const gateResult = await harnessController.executeEntryGate({
        capturePaths,
        platform: 'rdc-agent',
        entryMode: 'cli',
        backend: 'local',
      });

      if (gateResult.status === 'blocked') {
        return {
          success: false,
          error: gateResult.blockers.map(b => b.reason).join('; '),
        };
      }

      // 创建case和run
      const caseId = await storageAdapter.createCase({
        userGoal,
        symptomSummary: userGoal,
      });

      const { runId, sessionId } = await storageAdapter.createRun({
        caseId,
        capturePaths,
      });

      // 初始化工作流
      await workflowEngine.initialize({ caseId, runId, sessionId });

      // 执行intake gate
      const caseInput = {
        session: { mode: 'single', goal: userGoal },
        symptom: { summary: userGoal },
        captures: capturePaths.map((_p, i) => ({
          capture_id: `cap-${i === 0 ? 'anomalous' : 'baseline'}-${i}`,
          capture_role: i === 0 ? 'anomalous' : 'baseline',
        })),
      };

      const intakeResult = await harnessController.executeIntakeGate(caseId, runId, {
        caseInput,
        captureRefs: caseInput.captures,
      });

      if (intakeResult.status === 'blocked') {
        return {
          success: false,
          error: intakeResult.blockers.map(b => b.reason).join('; '),
        };
      }

      return { success: true, caseId, runId, sessionId };
    } catch (error) {
      console.error('Failed to start workflow:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle('workflow:advanceStage', async () => {
    const result = await workflowEngine.advanceStage();
    return {
      success: result.status === 'passed',
      currentStage: workflowEngine.getState()?.currentStage,
      error: result.status === 'blocked' ? result.blockers.map(b => b.reason).join('; ') : undefined,
    };
  });

  ipcMain.handle('workflow:backtrack', async (_event, reason: string, trigger: string) => {
    const result = await workflowEngine.backtrack({
      reason,
      trigger: trigger as 'specialist_timeout' | 'skeptic_rejected' | 'triage_low_confidence',
    });
    return {
      success: result.status === 'passed',
      error: result.status === 'blocked' ? result.blockers.map(b => b.reason).join('; ') : undefined,
    };
  });

  ipcMain.handle('workflow:dispatchSpecialist', async (_event, agentId: string, objective: string) => {
    const state = workflowEngine.getState();
    if (!state) {
      return { success: false, error: 'No active workflow' };
    }

    return agentOrchestrator.dispatchSpecialist(agentId as any, objective, {
      caseId: state.caseId,
      runId: state.runId,
      sessionId: state.sessionId,
    });
  });

  // ========== Agent操作 ==========

  ipcMain.handle('agent:sendMessage', async (_event, agentId: string, content: string) => {
    try {
      const state = workflowEngine.getState();
      const response = await agentOrchestrator.sendMessage(agentId as any, content, state ? {
        caseId: state.caseId,
        runId: state.runId,
        sessionId: state.sessionId,
      } : undefined);
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

  // ========== 证据链操作 ==========

  ipcMain.handle('evidence:getChain', async () => {
    const sessionId = await storageAdapter.getCurrentSessionId();
    if (!sessionId) {
      return { sessionId: '', runId: '', events: [], isValid: true };
    }

    const events = await storageAdapter.readActionChain(sessionId);
    return {
      sessionId,
      runId: workflowEngine.getState()?.runId || '',
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
    // TODO: 实现持久化settings
    return {
      theme: 'dark',
      llm: {
        defaultProvider: llmAdapter.getDefaultProvider(),
      },
      agents: {},
    };
  });

  ipcMain.handle('settings:set', async (_event, settings: unknown) => {
    // TODO: 实现持久化settings
    console.log('Set settings:', settings);
    return;
  });
}

/**
 * 设置主窗口引用（用于通知UI）
 */
export function setMainWindow(window: BrowserWindow): void {
  workflowEngine.setMainWindow(window);
  agentOrchestrator.setMainWindow(window);
}

/**
 * Workbench IPC composition root.
 */

import { BrowserWindow, nativeTheme } from 'electron';
import type { ActionEvent } from '@shared/types/evidence';
import type { SessionRecord } from '@shared/types/session';
import { replayDeviceService } from '../captures/ReplayDeviceService';
import { agentOrchestrator } from '../workflow/debugger/AgentOrchestrator';
import { debuggerRuntime } from '../workflow/debugger/DebuggerRuntime';
import { runExecutionService } from '../workflow/debugger/RunExecutionService';
import { llmAdapter } from '../settings/LLMAdapter';
import { settingsService } from '../settings/SettingsService';
import { storageAdapter } from '../sessions/StorageAdapter';
import { runtimeLogService } from '../runtime/RuntimeLogService';
import { rdxCliInvokerService } from '../tools/RdxCliInvokerService';
import { registerAgentHandlers } from './agentHandlers';
import { registerCaptureDeviceHandlers } from './captureDeviceHandlers';
import { registerConversationHandlers } from './conversationHandlers';
import { registerProjectSessionHandlers } from './projectSessionHandlers';
import { registerRuntimeTerminalHandlers } from './runtimeTerminalHandlers';
import { registerSettingsLlmHandlers } from './settingsLlmHandlers';
import { registerShellHandlers } from './shellHandlers';
import { buildSessionOutputs } from './sessionOutputs';
import { registerToolEvidenceHandlers } from './toolEvidenceHandlers';
import { registerWorkflowHandlers } from './workflowHandlers';
import { registerTraceHandlers } from './traceHandlers';
import { installIpcInvokeRegistry } from './invokeRegistry';
import { rendererEventHub } from '../browserAppBridge/rendererEventHub';
import type {
  ProjectSelectionResult,
  RunLifecyclePatch,
  WorkbenchIpcContext,
  WorkbenchIpcState,
} from './workbenchContext';

const state: WorkbenchIpcState = {
  currentSessionId: null,
  currentProjectId: null,
  currentRunId: null,
};

let toolTraceSubscribed = false;
let nativeThemeSubscribed = false;

export async function initializeIpcState(): Promise<void> {
  try {
    state.currentSessionId = await storageAdapter.getCurrentSessionId();
    state.currentProjectId = storageAdapter.getCurrentProjectId();
    state.currentRunId = state.currentSessionId
      ? storageAdapter.getLatestRun(state.currentSessionId)?.runId || null
      : null;
  } catch (error) {
    console.warn('[IPC] Failed to restore current session id:', error);
    state.currentSessionId = null;
    state.currentProjectId = null;
    state.currentRunId = null;
  }

  await debuggerRuntime.recoverInterruptedRuns();
}

function broadcastToRenderer(channel: string, ...args: unknown[]): void {
  rendererEventHub.emit(channel, ...args);
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

function applyCurrentLlmConfig(): void {
  const llmConfig = settingsService.getLlmConfig();
  llmAdapter.configure(llmConfig);
  agentOrchestrator.applyLlmConfig(llmConfig);
}

async function appendActionEvent(event: ActionEvent): Promise<void> {
  await storageAdapter.appendActionEvent(event.session_id, event);
  broadcastToRenderer('evidence:eventAdded', event);
}

async function setRunLifecycleState(
  sessionId: string,
  runId: string,
  patch: RunLifecyclePatch,
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

async function selectCurrentProject(projectId: string | null): Promise<ProjectSelectionResult> {
  if (!projectId) {
    state.currentProjectId = null;
    state.currentSessionId = null;
    state.currentRunId = null;
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

  state.currentProjectId = projectId;
  const selectedSession: SessionRecord | null = state.currentSessionId
    ? storageAdapter.readSession(state.currentSessionId)
    : null;
  if (!selectedSession || selectedSession.projectId !== projectId) {
    state.currentSessionId = null;
    state.currentRunId = null;
    await storageAdapter.setCurrentSessionId(null);
  } else {
    state.currentRunId = selectedSession.lastRunId || state.currentRunId;
  }
  storageAdapter.setCurrentProjectId(projectId);

  return {
    project,
    currentSession: selectedSession?.projectId === projectId ? selectedSession : null,
    currentRun: state.currentSessionId ? storageAdapter.getLatestRun(state.currentSessionId) : null,
  };
}

const context: WorkbenchIpcContext = {
  state,
  broadcastToRenderer,
  broadcastRunStatusChanged,
  applyCurrentLlmConfig,
  setRunLifecycleState,
  selectCurrentProject,
  buildSessionOutputs,
  initializeIpcState,
};

function registerToolTraceBridge(): void {
  if (toolTraceSubscribed) {
    return;
  }

  rdxCliInvokerService.onInvocationTrace((trace) => {
    broadcastToRenderer('tool:executionComplete', trace);
    if (state.currentSessionId && state.currentRunId) {
      void appendActionEvent(storageAdapter.createActionEvent({
        runId: state.currentRunId,
        sessionId: state.currentSessionId,
        agentId: trace.runtimeOwner || 'debugger',
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
      scope: state.currentSessionId ? 'session' : 'app',
      namespace: 'tool',
      severity: trace.result.ok ? 'success' : 'error',
      title: trace.toolName,
      summary: trace.result.ok
        ? '工具调用已完成。'
        : trace.result.error?.message ?? '工具调用失败。',
      detail: trace.result.duration_ms ? `${trace.result.duration_ms}ms` : undefined,
      sessionId: state.currentSessionId,
      projectId: state.currentProjectId,
      runId: state.currentRunId,
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

function preloadLlmConfig(): void {
  try {
    applyCurrentLlmConfig();
    console.log('[IPC] Loaded persisted LLM config');
  } catch (err) {
    console.warn('[IPC] Failed to preload LLM config:', err);
  }
}

function registerNativeThemeBridge(): void {
  if (nativeThemeSubscribed) {
    return;
  }

  nativeTheme.on('updated', () => {
    broadcastToRenderer('app:themeChanged', nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
  });
  nativeThemeSubscribed = true;
}

export function registerIPCHandlers(): void {
  installIpcInvokeRegistry();
  registerToolTraceBridge();
  preloadLlmConfig();
  registerShellHandlers();
  registerConversationHandlers(context);
  registerWorkflowHandlers(context);
  registerProjectSessionHandlers(context);
  registerRuntimeTerminalHandlers();
  registerCaptureDeviceHandlers(context);
  registerAgentHandlers(context);
  registerToolEvidenceHandlers(context);
  registerSettingsLlmHandlers(context);
  registerTraceHandlers(context);
  registerNativeThemeBridge();
}

export function setMainWindow(window: BrowserWindow): void {
  replayDeviceService.setMainWindow(window);
  agentOrchestrator.setMainWindow(window);
}

export async function stopAllActiveRuns(): Promise<void> {
  await runExecutionService.stopAll();
}

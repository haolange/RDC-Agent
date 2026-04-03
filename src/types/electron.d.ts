/**
 * Electron API Type Declarations
 */

import type { WorkflowStage, WorkflowState, BacktrackTrigger } from '../shared/types/workflow';
import type { AgentRole, AgentState, AgentConfig } from '../shared/types/agent';
import type { ActionEvent, EventType } from '../shared/types/evidence';
import type { ToolCallResult, ToolCatalog } from '../shared/types/tool';
import type { LLMConfig } from '../shared/types/llm';
import type { DebugSessionStartRequest, RunSummary, CaptureDescriptor, ContextSnapshot } from '../shared/types/session';
import type { ReplayDeviceEntry, ReplayDeviceStatusChangedPayload } from '../shared/types/device';

export interface ElectronAPI {
  platform: NodeJS.Platform;
  isMac: boolean;
  isWindows: boolean;
  isLinux: boolean;

  appMeta: {
    get: () => Promise<{
      version: string;
      productName: string;
    }>;
  };

  selectRdcFiles: () => Promise<string[] | null>;
  selectDirectory: () => Promise<string | null>;

  workflow: {
    getState: () => Promise<WorkflowState>;
    start: (request: DebugSessionStartRequest) => Promise<{
      success: boolean;
      caseId?: string;
      runId?: string;
      sessionId?: string;
      contextSnapshot?: ContextSnapshot;
      error?: string;
    }>;
    resume: (sessionId?: string) => Promise<{
      success: boolean;
      error?: string;
    }>;
    listRuns: () => Promise<{ runs: RunSummary[] }>;
    advanceStage: () => Promise<{
      success: boolean;
      currentStage?: WorkflowStage;
      error?: string;
    }>;
    backtrack: (reason: string, trigger: BacktrackTrigger) => Promise<{
      success: boolean;
      error?: string;
    }>;
    dispatchSpecialist: (agentId: AgentRole, objective: string) => Promise<{
      success: boolean;
      tokenId?: string;
      error?: string;
    }>;
  };

  agent: {
    sendMessage: (agentId: AgentRole, content: string) => Promise<{
      response?: string;
      error?: string;
    }>;
    getState: (agentId: AgentRole) => Promise<AgentState>;
    getAllStates: () => Promise<AgentState[]>;
    configure: (agentId: AgentRole, config: Partial<AgentConfig>) => Promise<{
      success: boolean;
      error?: string;
    }>;
  };

  tool: {
    getCatalog: () => Promise<ToolCatalog>;
    execute: (toolName: string, args: Record<string, unknown>) => Promise<ToolCallResult>;
  };

  evidence: {
    getChain: () => Promise<{
      sessionId: string;
      runId: string;
      events: ActionEvent[];
      isValid: boolean;
    }>;
    getEvents: (eventType?: EventType) => Promise<ActionEvent[]>;
  };

  llm: {
    configure: (config: LLMConfig) => Promise<void>;
    testConnection: (provider: string) => Promise<{
      success: boolean;
      error?: string;
    }>;
    getAvailableModels: (provider: string) => Promise<string[]>;
  };

  settings: {
    get: () => Promise<{
      theme: string;
      llm: {
        defaultProvider: string;
      };
      agents: Record<AgentRole, Partial<AgentConfig>>;
      openRouter?: unknown;
    }>;
    set: (settings: Record<string, unknown>) => Promise<void>;
  };

  device: {
    list: () => Promise<ReplayDeviceEntry[]>;
    refresh: () => Promise<ReplayDeviceEntry[]>;
    activate: (deviceId: string) => Promise<ReplayDeviceEntry>;
  };

  session: {
    list: () => Promise<{ sessions: unknown[] }>;
    select: (id: string) => Promise<{ success: boolean }>;
  };

  capture: {
    open: (filePath?: string) => Promise<unknown>;
    list: () => Promise<{ captures: CaptureDescriptor[] }>;
    select: (captureId: string) => Promise<{
      success: boolean;
      error?: string;
    }>;
  };

  context: {
    get: () => Promise<ContextSnapshot>;
  };

  events: {
    onWorkflowStateChanged: (callback: (state: WorkflowState) => void) => void;
    onWorkflowStageChanged: (callback: (data: { stage: WorkflowStage; blockers: unknown[] }) => void) => void;
    onAgentMessage: (callback: (msg: unknown) => void) => void;
    onAgentStatusChanged: (callback: (state: AgentState) => void) => void;
    onToolExecutionComplete: (callback: (trace: unknown) => void) => void;
    onEvidenceEventAdded: (callback: (event: ActionEvent) => void) => void;
    onDeviceStatusChanged: (callback: (status: ReplayDeviceStatusChangedPayload) => void) => void;
    onCaptureStatusChanged: (callback: (status: unknown) => void) => void;
    onContextChanged: (callback: (snapshot: ContextSnapshot) => void) => void;
    removeAllListeners: (channel: string) => void;
  };

  windowControls: {
    minimize: () => Promise<void>;
    toggleMaximize: () => Promise<boolean>;
    close: () => Promise<void>;
    isMaximized: () => Promise<boolean>;
  };

  on: (channel: string, callback: (...args: unknown[]) => void) => void;
  off: (channel: string, callback: (...args: unknown[]) => void) => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};

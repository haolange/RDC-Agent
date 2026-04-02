/**
 * Electron API Type Declarations
 */

import type { WorkflowStage, WorkflowState, BacktrackTrigger } from '../shared/types/workflow';
import type { AgentRole, AgentState, AgentConfig } from '../shared/types/agent';
import type { ActionEvent, EventType } from '../shared/types/evidence';
import type { ToolCallResult, ToolCatalog } from '../shared/types/tool';
import type { LLMConfig } from '../shared/types/llm';

export interface ElectronAPI {
  // Platform info
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

  // File operations
  selectRdcFiles: () => Promise<string[] | null>;
  selectDirectory: () => Promise<string | null>;

  // Workflow operations
  workflow: {
    getState: () => Promise<WorkflowState>;
    start: (capturePaths: string[], userGoal: string) => Promise<{
      success: boolean;
      caseId?: string;
      runId?: string;
      sessionId?: string;
      error?: string;
    }>;
    advanceStage: () => Promise<{
      success: boolean;
      currentStage?: WorkflowStage;
      error?: string;
    }>;
    backtrack: (reason: string, trigger: BacktrackTrigger) => Promise<{
      success: boolean;
      error?: string;
    }>;
    dispatchSpecialist: (
      agentId: AgentRole,
      objective: string
    ) => Promise<{
      success: boolean;
      tokenId?: string;
      error?: string;
    }>;
  };

  // Agent operations
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

  // Tool operations
  tool: {
    getCatalog: () => Promise<ToolCatalog>;
    execute: (toolName: string, args: Record<string, unknown>) => Promise<ToolCallResult>;
  };

  // Evidence chain operations
  evidence: {
    getChain: () => Promise<{
      sessionId: string;
      runId: string;
      events: ActionEvent[];
      isValid: boolean;
    }>;
    getEvents: (eventType?: EventType) => Promise<ActionEvent[]>;
  };

  // LLM operations
  llm: {
    configure: (config: LLMConfig) => Promise<void>;
    testConnection: (provider: string) => Promise<{
      success: boolean;
      error?: string;
    }>;
    getAvailableModels: (provider: string) => Promise<string[]>;
  };

  // Settings operations
  settings: {
    get: () => Promise<{
      theme: string;
      llm: {
        defaultProvider: string;
      };
      agents: Record<AgentRole, Partial<AgentConfig>>;
    }>;
    set: (settings: Record<string, unknown>) => Promise<void>;
  };

  windowControls: {
    minimize: () => Promise<void>;
    toggleMaximize: () => Promise<boolean>;
    close: () => Promise<void>;
    isMaximized: () => Promise<boolean>;
  };

  // Event listeners
  on: (channel: string, callback: (...args: unknown[]) => void) => void;
  off: (channel: string, callback: (...args: unknown[]) => void) => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};

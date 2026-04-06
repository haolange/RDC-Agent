/**
 * Agent Types - Agent角色相关类型定义
 */

import type { LlmProviderId } from './settings';

// Agent角色
export type AgentRole =
  | 'rdc-debugger'           // 主入口/Orchestrator
  | 'triage_agent'           // 症状分类
  | 'capture_repro_agent'    // Capture复现
  | 'pass_graph_pipeline_agent'  // Pass/Pipeline分析
  | 'pixel_forensics_agent'  // 像素取证
  | 'shader_ir_agent'        // Shader IR分析
  | 'driver_device_agent'    // 驱动设备分析
  | 'skeptic_agent'          // 审批者
  | 'curator_agent';         // 报告/知识沉淀

// Agent角色类别
export type AgentCategory = 'orchestrator' | 'investigator' | 'verifier' | 'reporter';

// Agent状态
export type AgentStatus = 'idle' | 'thinking' | 'executing' | 'waiting' | 'complete' | 'error';

// Agent配置
export interface AgentConfig {
  agentId: AgentRole;
  systemPrompt: string;           // 可自定义System Prompt
  modelProvider: LlmProviderId;
  modelName: string;              // 具体模型名称
  temperature?: number;
  maxTokens?: number;
  category: AgentCategory;
  writeScope: WriteScope[];
}

// 写入范围
export type WriteScope =
  | 'workspace_control'
  | 'workspace_notes'
  | 'session_signoff'
  | 'workspace_reports'
  | 'session_artifacts'
  | 'knowledge_library';

// Agent运行时状态
export interface AgentState {
  agentId: AgentRole;
  status: AgentStatus;
  token?: SpecialistToken;
  brief?: string;
  lastActivity: string;
  error?: string;
}

// Specialist Token
export interface SpecialistToken {
  token_id: string;
  agent_id: AgentRole;
  issued_at: string;
  expires_at: string;
  scope: string[];
  status: 'valid' | 'expired' | 'revoked';
  runtime_owner: string;
}

// Agent消息
export interface AgentMessage {
  id: string;
  agentId: AgentRole;
  role: 'assistant' | 'user' | 'system';
  content: string;
  timestamp: number;
  toolCalls?: {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
    result?: unknown;
  }[];
}

// Agent对话
export interface AgentConversation {
  id: string;
  caseId: string;
  runId: string;
  sessionId: string;
  messages: AgentMessage[];
  activeAgent: AgentRole;
  lastUpdated: string;
}

// 默认模型路由
export const DEFAULT_MODEL_ROUTING: Record<AgentRole, { provider: LlmProviderId; model: string }> = {
  'rdc-debugger': { provider: 'openrouter', model: 'anthropic/claude-3-opus' },
  'triage_agent': { provider: 'openrouter', model: 'anthropic/claude-3-sonnet' },
  'capture_repro_agent': { provider: 'openrouter', model: 'anthropic/claude-3-sonnet' },
  'pass_graph_pipeline_agent': { provider: 'openrouter', model: 'anthropic/claude-3-sonnet' },
  'pixel_forensics_agent': { provider: 'openrouter', model: 'google/gemini-pro-1.5' },
  'shader_ir_agent': { provider: 'openrouter', model: 'anthropic/claude-3-sonnet' },
  'driver_device_agent': { provider: 'openrouter', model: 'anthropic/claude-3-sonnet' },
  'skeptic_agent': { provider: 'openrouter', model: 'openai/gpt-4o' },
  'curator_agent': { provider: 'openrouter', model: 'anthropic/claude-3-sonnet' },
};

// Agent角色到类别映射
export const AGENT_CATEGORY_MAP: Record<AgentRole, AgentCategory> = {
  'rdc-debugger': 'orchestrator',
  'triage_agent': 'investigator',
  'capture_repro_agent': 'investigator',
  'pass_graph_pipeline_agent': 'investigator',
  'pixel_forensics_agent': 'investigator',
  'shader_ir_agent': 'investigator',
  'driver_device_agent': 'investigator',
  'skeptic_agent': 'verifier',
  'curator_agent': 'reporter',
};

// ============================================
// Agent Timeline 类型
// ============================================

import type { ToolTraceEntry } from './tool';
import type { ActionEvent } from './evidence';
import type { ReasoningSummary } from './workflow';

/** Agent 时间线条目 */
export interface AgentTimelineEntry {
  id: string;
  type:
    | 'user'
    | 'agent'
    | 'tool_call'
    | 'blocker'
    | 'system'
    | 'plan'
    | 'stage'
    | 'dispatch'
    | 'verification'
    | 'report'
    | 'reasoning';
  agentRole?: AgentRole;
  content: string;
  title?: string;
  status?: string;
  toolTrace?: ToolTraceEntry;
  actionEvent?: ActionEvent;
  reasoningSummary?: ReasoningSummary;
  timestamp: number;
  refs?: string[];
}

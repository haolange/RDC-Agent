/**
 * Agent Constants - Agent角色常量定义
 */

import type { AgentRole, AgentCategory, WriteScope } from '../types/agent';
import type { ModeConfig } from '../types/layout';
import { DEFAULT_MODEL_ROUTING } from '../types/agent';

// 重新导出 DEFAULT_MODEL_ROUTING
export { DEFAULT_MODEL_ROUTING };

// 所有Agent角色
export const AGENT_ROLES: AgentRole[] = [
  'rdc-debugger',
  'triage_agent',
  'capture_repro_agent',
  'pass_graph_pipeline_agent',
  'pixel_forensics_agent',
  'shader_ir_agent',
  'driver_device_agent',
  'skeptic_agent',
  'curator_agent',
];

// Agent显示名称
export const AGENT_DISPLAY_NAMES: Record<AgentRole, string> = {
  'rdc-debugger': 'RDC Debugger',
  'triage_agent': 'Triage Agent',
  'capture_repro_agent': 'Capture Repro Agent',
  'pass_graph_pipeline_agent': 'Pass Graph Agent',
  'pixel_forensics_agent': 'Pixel Forensics Agent',
  'shader_ir_agent': 'Shader IR Agent',
  'driver_device_agent': 'Driver Device Agent',
  'skeptic_agent': 'Skeptic Agent',
  'curator_agent': 'Curator Agent',
};

// Agent描述
export const AGENT_DESCRIPTIONS: Record<AgentRole, string> = {
  'rdc-debugger': 'Main orchestrator responsible for workflow coordination, gates, and stage progression',
  'triage_agent': 'Symptom classification and SOP recommendation',
  'capture_repro_agent': 'Capture quality verification and baseline establishment',
  'pass_graph_pipeline_agent': 'Render pass and pipeline dependency analysis',
  'pixel_forensics_agent': 'Pixel-level evidence collection and first-bad event localization',
  'shader_ir_agent': 'Shader source and IR evidence analysis',
  'driver_device_agent': 'Cross-device attribution and platform-specific checks',
  'skeptic_agent': 'Evidence chain challenger and weak claim detector',
  'curator_agent': 'Final report generation and knowledge library curation',
};

// Agent类别
export const AGENT_CATEGORIES: Record<AgentRole, AgentCategory> = {
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

// Investigator Agents（需要dispatch的specialists）
export const INVESTIGATOR_AGENTS: AgentRole[] = [
  'triage_agent',
  'capture_repro_agent',
  'pass_graph_pipeline_agent',
  'pixel_forensics_agent',
  'shader_ir_agent',
  'driver_device_agent',
];

// Verifier Agents
export const VERIFIER_AGENTS: AgentRole[] = ['skeptic_agent'];

// Reporter Agents
export const REPORTER_AGENTS: AgentRole[] = ['curator_agent'];

// Agent写入范围
export const AGENT_WRITE_SCOPES: Record<AgentRole, WriteScope[]> = {
  'rdc-debugger': ['workspace_control'],
  'triage_agent': ['workspace_notes'],
  'capture_repro_agent': ['workspace_notes'],
  'pass_graph_pipeline_agent': ['workspace_notes'],
  'pixel_forensics_agent': ['workspace_notes'],
  'shader_ir_agent': ['workspace_notes'],
  'driver_device_agent': ['workspace_notes'],
  'skeptic_agent': ['session_signoff'],
  'curator_agent': ['workspace_reports', 'session_artifacts', 'knowledge_library'],
};

// Agent笔记文件名
export const AGENT_NOTE_FILES: Record<AgentRole, string> = {
  'rdc-debugger': '',
  'triage_agent': 'triage.md',
  'capture_repro_agent': 'capture_repro.md',
  'pass_graph_pipeline_agent': 'pass_graph_pipeline.md',
  'pixel_forensics_agent': 'pixel_forensics.md',
  'shader_ir_agent': 'shader_ir.md',
  'driver_device_agent': 'driver_device.md',
  'skeptic_agent': 'skeptic.md',
  'curator_agent': 'curator.md',
};

// 默认TTL（秒）
export const DEFAULT_TOKEN_TTL_SECONDS = 1800;

// Agent Colors for UI
export const AGENT_COLORS: Record<AgentRole, string> = {
  'rdc-debugger': '#6366f1',
  'triage_agent': '#a855f7',
  'capture_repro_agent': '#3b82f6',
  'pass_graph_pipeline_agent': '#06b6d4',
  'pixel_forensics_agent': '#10b981',
  'shader_ir_agent': '#f59e0b',
  'driver_device_agent': '#ef4444',
  'skeptic_agent': '#ec4899',
  'curator_agent': '#8b5cf6',
};

// Agent 工作模式配置
export const AGENT_MODES: ModeConfig[] = [
  {
    id: 'debugger',
    label: 'Debugger',
    icon: 'crosshair-bug',
    description: 'Debug and diagnose rendering issues',
    accentColor: '#33d1ff',
    emptyTitle: '从异常现象开始，逐步定位 GPU 问题。',
    emptySubtitle: '面向 RenderDoc 与 .rdc capture 的调试工作台。',
    helperCopy: '描述异常、附加图片或文件，或者直接导入 .rdc capture 开始排查。',
    disabled: false,
  },
  {
    id: 'analyzer',
    label: 'Analyzer',
    icon: 'waveform-gauge',
    description: 'Analyze rendering captures and performance',
    accentColor: '#8d8bff',
    emptyTitle: '把线索拆开看，把证据串起来。',
    emptySubtitle: '聚焦现象分解、证据整理与多模态分析组合。',
    helperCopy: '贴问题、附上下文素材或 capture 线索，我会先帮你拆结构、找证据和判断方向。',
    disabled: false,
  },
  {
    id: 'optimizer',
    label: 'Optimizer',
    icon: 'spark-tuning',
    description: 'Generate optimization suggestions',
    accentColor: '#4ee3a0',
    emptyTitle: '先看瓶颈，再给出可执行的优化路径。',
    emptySubtitle: '适合评估性能、成本和渲染管线的收敛空间。',
    helperCopy: '可以附性能截图、日志或参考素材，我会按收益、风险和验证路径组织建议。',
    disabled: false,
  },
];

export const AGENT_MODE_MAP: Record<ModeConfig['id'], ModeConfig> = AGENT_MODES.reduce(
  (accumulator, mode) => {
    accumulator[mode.id] = mode;
    return accumulator;
  },
  {} as Record<ModeConfig['id'], ModeConfig>,
);

export function getAgentModeConfig(modeId: ModeConfig['id']): ModeConfig {
  return AGENT_MODE_MAP[modeId];
}

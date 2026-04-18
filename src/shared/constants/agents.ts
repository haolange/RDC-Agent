/**
 * Agent Constants
 */

import type { AgentRole, AgentCategory, WriteScope } from '../types/agent';
import type { ModeConfig } from '../types/layout';
import { DEFAULT_MODEL_ROUTING } from '../types/agent';

export { DEFAULT_MODEL_ROUTING };

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

export const INVESTIGATOR_AGENTS: AgentRole[] = [
  'triage_agent',
  'capture_repro_agent',
  'pass_graph_pipeline_agent',
  'pixel_forensics_agent',
  'shader_ir_agent',
  'driver_device_agent',
];

export const VERIFIER_AGENTS: AgentRole[] = ['skeptic_agent'];

export const REPORTER_AGENTS: AgentRole[] = ['curator_agent'];

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

export const DEFAULT_TOKEN_TTL_SECONDS = 1800;

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

export const AGENT_MODES: ModeConfig[] = [
  {
    id: 'debugger',
    label: 'Debugger',
    icon: 'crosshair-bug',
    description: '定位异常与验证修复',
    accentColor: '#33d1ff',
    emptyTitle: '从异常现象出发，定位 GPU 问题',
    emptySubtitle: '围绕 `.rdc` Capture、截图与线索快速展开排查。',
    helperCopy: '补充异常、截图或 `.rdc` Capture，直接开始定位。',
    disabled: false,
  },
  {
    id: 'analyzer',
    label: 'Analyzer',
    icon: 'waveform-gauge',
    description: '拆解现象并收敛证据',
    accentColor: '#8d8bff',
    emptyTitle: '拆开线索，串起证据',
    emptySubtitle: '适合对比现象、梳理上下文与收敛判断方向。',
    helperCopy: '贴出问题与素材，我会先整理结构和证据。',
    disabled: false,
  },
  {
    id: 'optimizer',
    label: 'Optimizer',
    icon: 'spark-tuning',
    description: '判断瓶颈与优化顺序',
    accentColor: '#4ee3a0',
    emptyTitle: '先找瓶颈，再排优化顺序',
    emptySubtitle: '适合评估性能收益、成本与验证优先级。',
    helperCopy: '补充性能线索后，我会按收益和风险整理建议。',
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

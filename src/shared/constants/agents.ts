import type { AgentCategory, AgentId, AgentRole, WriteScope } from '../types/agent';
import type { ModeConfig } from '../types/layout';
import { DEFAULT_MODEL_ROUTING, TOP_LEVEL_AGENT_IDS, isTopLevelAgentId } from '../types/agent';

export { DEFAULT_MODEL_ROUTING, isTopLevelAgentId };

export const AGENT_ROLES: AgentId[] = [...TOP_LEVEL_AGENT_IDS];

export const AGENT_DISPLAY_NAMES: Record<AgentId, string> = {
  ask: 'Ask',
  debugger: 'Debugger',
  analyzer: 'Analyzer',
  optimizer: 'Optimizer',
};

export const AGENT_DESCRIPTIONS: Record<AgentId, string> = {
  ask: 'Read-only agent for codebase questions, clarification, and guidance.',
  debugger: 'General executable agent for RDC/RenderDoc investigation and debugging work.',
  analyzer: 'General executable agent for evidence analysis, performance triage, and reportable findings.',
  optimizer: 'General executable agent for bottleneck analysis, optimization ordering, and validation.',
};

export const AGENT_CATEGORIES: Record<AgentId, AgentCategory> = {
  ask: 'orchestrator',
  debugger: 'general',
  analyzer: 'general',
  optimizer: 'general',
};

export const INVESTIGATOR_AGENTS: AgentRole[] = ['debugger', 'analyzer', 'optimizer'];
export const VERIFIER_AGENTS: AgentRole[] = [];
export const REPORTER_AGENTS: AgentRole[] = [];

export const AGENT_WRITE_SCOPES: Record<AgentId, WriteScope[]> = {
  ask: [],
  debugger: ['workspace_control', 'workspace_notes', 'session_artifacts', 'workspace_reports'],
  analyzer: ['workspace_notes', 'session_artifacts', 'workspace_reports'],
  optimizer: ['workspace_notes', 'session_artifacts', 'workspace_reports'],
};

export const AGENT_NOTE_FILES: Record<AgentId, string> = {
  ask: '',
  debugger: '',
  analyzer: '',
  optimizer: '',
};

export const DEFAULT_TOKEN_TTL_SECONDS = 1800;

export const AGENT_COLORS: Record<AgentId, string> = {
  ask: '#38c6f4',
  debugger: '#33d1ff',
  analyzer: '#8d8bff',
  optimizer: '#4ee3a0',
};

export const AGENT_MODES: ModeConfig[] = [
  {
    id: 'ask',
    label: 'Ask',
    icon: 'message-orbit',
    description: 'Read-only clarification and guidance',
    accentColor: AGENT_COLORS.ask,
    disabled: false,
  },
  {
    id: 'debugger',
    label: 'Debugger',
    icon: 'crosshair-bug',
    description: 'Executable RDC/RenderDoc debugging agent',
    accentColor: AGENT_COLORS.debugger,
    disabled: false,
  },
  {
    id: 'analyzer',
    label: 'Analyzer',
    icon: 'waveform-gauge',
    description: 'Executable analysis and evidence agent',
    accentColor: AGENT_COLORS.analyzer,
    disabled: false,
  },
  {
    id: 'optimizer',
    label: 'Optimizer',
    icon: 'spark-tuning',
    description: 'Executable optimization and validation agent',
    accentColor: AGENT_COLORS.optimizer,
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

import type { AgentId, AgentRole } from '../types/agent';
import type { AgentManifestDefinition } from '../types/agentManifest';
import type { ModeConfig } from '../types/layout';
import { DEFAULT_MODEL_ROUTING, TOP_LEVEL_AGENT_IDS, isTopLevelAgentId } from '../types/agent';
import { COMPOSE_ACCENT_FALLBACK, normalizeAgentAccent } from '../theme/composeAccent';

export { DEFAULT_MODEL_ROUTING, isTopLevelAgentId };

export const AGENT_ROLES: AgentId[] = [...TOP_LEVEL_AGENT_IDS];

export const AGENT_DISPLAY_NAMES: Record<AgentId, string> = {
  general: 'General',
  debugger: 'Debugger',
  analyzer: 'Analyzer',
  optimizer: 'Optimizer',
};

export const AGENT_DESCRIPTIONS: Record<AgentId, string> = {
  general: 'Execution Orchestrator for ordinary read, write, search, shell, and tool work.',
  debugger: 'Planning Orchestrator that minimizes root-cause uncertainty for incorrect rendering results.',
  analyzer: 'Planning Orchestrator that maximizes explainability of an unknown rendering system.',
  optimizer: 'Planning Orchestrator that minimizes cost while preserving correctness, quality, and scope.',
};

export const INVESTIGATOR_AGENTS: AgentRole[] = ['debugger', 'analyzer', 'optimizer'];
export const VERIFIER_AGENTS: AgentRole[] = [];
export const REPORTER_AGENTS: AgentRole[] = [];

export const AGENT_NOTE_FILES: Record<AgentId, string> = {
  general: '',
  debugger: '',
  analyzer: '',
  optimizer: '',
};

export const DEFAULT_TOKEN_TTL_SECONDS = 1800;

/** Seed accents written into new builtin `.agent.md` files only — not runtime authority. */
export const AGENT_SEED_ACCENTS: Record<AgentId, string> = {
  general: '#33d1ff',
  debugger: '#33d1ff',
  analyzer: '#8d8bff',
  optimizer: '#4ee3a0',
};

export const AGENT_MODES: ModeConfig[] = [
  {
    id: 'general',
    label: 'General',
    icon: 'nodes',
    description: 'Execution orchestrator for ordinary work',
    accentColor: AGENT_SEED_ACCENTS.general,
    disabled: false,
  },
  {
    id: 'debugger',
    label: 'Debugger',
    icon: 'crosshair-bug',
    description: 'Planning orchestrator for root-cause investigation',
    accentColor: AGENT_SEED_ACCENTS.debugger,
    disabled: false,
  },
  {
    id: 'analyzer',
    label: 'Analyzer',
    icon: 'waveform-gauge',
    description: 'Planning orchestrator for system explanation',
    accentColor: AGENT_SEED_ACCENTS.analyzer,
    disabled: false,
  },
  {
    id: 'optimizer',
    label: 'Optimizer',
    icon: 'spark-tuning',
    description: 'Planning orchestrator for cost reduction',
    accentColor: AGENT_SEED_ACCENTS.optimizer,
    disabled: false,
  },
];

export const AGENT_ICON_PRESETS: Array<{
  id: ModeConfig['icon'];
  label: string;
}> = [
  { id: 'message-orbit', label: 'Ask' },
  { id: 'route-plan', label: 'Plan' },
  { id: 'pencil-edit', label: 'Edit' },
  { id: 'crosshair-bug', label: 'Debug' },
  { id: 'waveform-gauge', label: 'Analyze' },
  { id: 'spark-tuning', label: 'Optimize' },
  { id: 'compass', label: 'Explore' },
  { id: 'terminal', label: 'Shell' },
  { id: 'shield', label: 'Review' },
  { id: 'wrench', label: 'Build' },
  { id: 'search-lens', label: 'Search' },
  { id: 'nodes', label: 'Orchestrate' },
  { id: 'memory', label: 'Memory' },
  { id: 'spark', label: 'Create' },
];

export function isAgentIconPreset(value: unknown): value is ModeConfig['icon'] {
  return typeof value === 'string' && AGENT_ICON_PRESETS.some((preset) => preset.id === value);
}

export const AGENT_MODE_MAP: Partial<Record<string, ModeConfig>> = AGENT_MODES.reduce(
  (accumulator, mode) => {
    accumulator[mode.id] = mode;
    return accumulator;
  },
  {} as Partial<Record<string, ModeConfig>>,
);

export function getAgentModeConfig(modeId: ModeConfig['id']): ModeConfig | null {
  return AGENT_MODE_MAP[modeId] ?? null;
}

export interface AgentDisplayInfo {
  name: string;
  glyph: string;
  icon: ModeConfig['icon'];
  accent: string;
}

export function resolveAgentDisplay(agentId: string, definitions: AgentManifestDefinition[]): AgentDisplayInfo {
  const manifest = definitions.find((d) => d.id === agentId);
  const seed = AGENT_SEED_ACCENTS[agentId as AgentId] ?? COMPOSE_ACCENT_FALLBACK;
  return {
    name: manifest?.name ?? AGENT_DISPLAY_NAMES[agentId as AgentId] ?? agentId,
    glyph: (manifest?.name ?? AGENT_DISPLAY_NAMES[agentId as AgentId] ?? agentId).slice(0, 2).toUpperCase(),
    icon: manifest?.icon ?? AGENT_MODE_MAP[agentId]?.icon ?? 'message-orbit',
    accent: normalizeAgentAccent(manifest?.accent, seed),
  };
}

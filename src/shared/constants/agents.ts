import type { AgentCategory, AgentId, AgentRole, WriteScope } from '../types/agent';
import type { AgentManifestDefinition } from '../types/agentManifest';
import type { ModeConfig } from '../types/layout';
import { DEFAULT_MODEL_ROUTING, TOP_LEVEL_AGENT_IDS, isTopLevelAgentId } from '../types/agent';
import { COMPOSE_ACCENT_FALLBACK, normalizeAgentAccent } from '../theme/composeAccent';

export { DEFAULT_MODEL_ROUTING, isTopLevelAgentId };

export const AGENT_ROLES: AgentId[] = [...TOP_LEVEL_AGENT_IDS];

export const AGENT_DISPLAY_NAMES: Record<AgentId, string> = {
  ask: 'Ask',
  plan: 'Plan',
  edit: 'Edit',
  debugger: 'Debugger',
  analyzer: 'Analyzer',
  optimizer: 'Optimizer',
};

export const AGENT_DESCRIPTIONS: Record<AgentId, string> = {
  ask: 'Read-only agent for codebase questions, clarification, and guidance.',
  plan: 'Planning agent for research, questions, handoffs, and implementation plans without direct changes.',
  edit: 'General implementation agent for ordinary code and workspace changes with approval policy.',
  debugger: 'General executable agent for RDC/RenderDoc investigation and debugging work.',
  analyzer: 'General executable agent for evidence analysis, performance triage, and reportable findings.',
  optimizer: 'General executable agent for bottleneck analysis, optimization ordering, and validation.',
};

export const AGENT_CATEGORIES: Record<AgentId, AgentCategory> = {
  ask: 'orchestrator',
  plan: 'orchestrator',
  edit: 'orchestrator',
  debugger: 'general',
  analyzer: 'general',
  optimizer: 'general',
};

export const INVESTIGATOR_AGENTS: AgentRole[] = ['debugger', 'analyzer', 'optimizer'];
export const VERIFIER_AGENTS: AgentRole[] = [];
export const REPORTER_AGENTS: AgentRole[] = [];

export const AGENT_WRITE_SCOPES: Record<AgentId, WriteScope[]> = {
  ask: [],
  plan: ['workspace_notes'],
  edit: ['workspace_notes', 'session_artifacts', 'workspace_reports'],
  debugger: ['workspace_control', 'workspace_notes', 'session_artifacts', 'workspace_reports'],
  analyzer: ['workspace_notes', 'session_artifacts', 'workspace_reports'],
  optimizer: ['workspace_notes', 'session_artifacts', 'workspace_reports'],
};

export const AGENT_NOTE_FILES: Record<AgentId, string> = {
  ask: '',
  plan: '',
  edit: '',
  debugger: '',
  analyzer: '',
  optimizer: '',
};

export const DEFAULT_TOKEN_TTL_SECONDS = 1800;

/** Seed accents written into new builtin `.agent.md` files only — not runtime authority. */
export const AGENT_SEED_ACCENTS: Record<AgentId, string> = {
  ask: '#38c6f4',
  plan: '#8d8bff',
  edit: '#33d1ff',
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
    accentColor: AGENT_SEED_ACCENTS.ask,
    disabled: false,
  },
  {
    id: 'plan',
    label: 'Plan',
    icon: 'route-plan',
    description: 'Research, questions, handoff, and implementation planning',
    accentColor: AGENT_SEED_ACCENTS.plan,
    disabled: false,
  },
  {
    id: 'edit',
    label: 'Edit',
    icon: 'pencil-edit',
    description: 'General implementation agent',
    accentColor: AGENT_SEED_ACCENTS.edit,
    disabled: false,
  },
  {
    id: 'debugger',
    label: 'Debugger',
    icon: 'crosshair-bug',
    description: 'Executable RDC/RenderDoc debugging agent',
    accentColor: AGENT_SEED_ACCENTS.debugger,
    disabled: false,
  },
  {
    id: 'analyzer',
    label: 'Analyzer',
    icon: 'waveform-gauge',
    description: 'Executable analysis and evidence agent',
    accentColor: AGENT_SEED_ACCENTS.analyzer,
    disabled: false,
  },
  {
    id: 'optimizer',
    label: 'Optimizer',
    icon: 'spark-tuning',
    description: 'Executable optimization and validation agent',
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

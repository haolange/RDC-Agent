import { hashSeedSemanticManifest, type SeedSemanticManifest } from './semanticHash';

export interface OfficialSeedGeneration {
  id: string;
  sourceCommit: string;
  sourcedAt: string;
  note: string;
  manifests: SeedSemanticManifest[];
}

const planHandoff = {
  label: 'Start Implementation',
  agent: 'edit',
  prompt: 'Start implementing the approved plan.',
};

const names = {
  ask: 'Ask',
  plan: 'Plan',
  edit: 'Edit',
  debugger: 'Debugger',
  analyzer: 'Analyzer',
  optimizer: 'Optimizer',
} as const;

const descriptions = {
  ask: 'Read-only agent for codebase questions, clarification, and guidance.',
  plan: 'Planning agent for research, questions, handoffs, and implementation plans without direct changes.',
  edit: 'General implementation agent for ordinary code and workspace changes with approval policy.',
  debugger: 'General executable agent for RDC/RenderDoc investigation and debugging work.',
  analyzer: 'General executable agent for evidence analysis, performance triage, and reportable findings.',
  optimizer: 'General executable agent for bottleneck analysis, optimization ordering, and validation.',
} as const;

const icons = {
  ask: 'message-orbit',
  plan: 'route-plan',
  edit: 'pencil-edit',
  debugger: 'crosshair-bug',
  analyzer: 'waveform-gauge',
  optimizer: 'spark-tuning',
} as const;

const accents = {
  ask: '#38c6f4',
  plan: '#8d8bff',
  edit: '#33d1ff',
  debugger: '#33d1ff',
  analyzer: '#8d8bff',
  optimizer: '#4ee3a0',
} as const;

const askHint = 'Ask about the current project, capture, or workflow';
const missionHint = 'Describe the RenderDoc/RDC investigation goal';

function seed(
  id: string,
  options: Partial<SeedSemanticManifest> & Pick<SeedSemanticManifest, 'name' | 'description' | 'tools' | 'agents'>,
): SeedSemanticManifest {
  return {
    id,
    name: options.name,
    description: options.description,
    argumentHint: options.argumentHint ?? (id === 'ask' || id === 'ask_agent' ? askHint : missionHint),
    target: options.target ?? 'rdc-agent',
    models: options.models ?? [],
    icon: options.icon ?? null,
    accent: options.accent ?? null,
    enabled: options.enabled ?? true,
    userInvocable: options.userInvocable ?? true,
    disableModelInvocation: options.disableModelInvocation ?? false,
    maxTurns: options.maxTurns ?? null,
    tools: options.tools,
    skills: options.skills ?? [],
    mcpServers: options.mcpServers ?? [],
    agents: options.agents,
    handoffs: options.handoffs ?? [],
    metadata: options.metadata ?? {},
    instructions: options.instructions ?? `You are ${options.name}. ${options.description}.`,
  };
}

export const OFFICIAL_S0_SEED_IDS = [
  'ask_agent',
  'rdc-debugger',
  'triage_agent',
  'capture_repro_agent',
  'pass_graph_pipeline_agent',
  'pixel_forensics_agent',
  'shader_ir_agent',
  'driver_device_agent',
  'skeptic_agent',
  'curator_agent',
] as const;

const S0_IDS = OFFICIAL_S0_SEED_IDS;

const S0_NAMES: Record<(typeof S0_IDS)[number], string> = {
  ask_agent: 'Ask',
  'rdc-debugger': 'RDC Debugger',
  triage_agent: 'Triage Agent',
  capture_repro_agent: 'Capture Repro Agent',
  pass_graph_pipeline_agent: 'Pass Graph Agent',
  pixel_forensics_agent: 'Pixel Forensics Agent',
  shader_ir_agent: 'Shader IR Agent',
  driver_device_agent: 'Driver Device Agent',
  skeptic_agent: 'Skeptic Agent',
  curator_agent: 'Curator Agent',
};

const S0_DESCRIPTIONS: Record<(typeof S0_IDS)[number], string> = {
  ask_agent: 'Non-executing assistant for clarification, capability explanation, and Open capture guidance',
  'rdc-debugger': 'Main orchestrator responsible for workflow coordination, gates, and stage progression',
  triage_agent: 'Symptom classification and SOP recommendation',
  capture_repro_agent: 'Capture quality verification and baseline establishment',
  pass_graph_pipeline_agent: 'Render pass and pipeline dependency analysis',
  pixel_forensics_agent: 'Pixel-level evidence collection and first-bad event localization',
  shader_ir_agent: 'Shader source and IR evidence analysis',
  driver_device_agent: 'Cross-device attribution and platform-specific checks',
  skeptic_agent: 'Evidence chain challenger and weak claim detector',
  curator_agent: 'Final report generation and knowledge library curation',
};

const S1_IDS = ['ask', 'debugger', 'analyzer', 'optimizer'] as const;
const S2_IDS = ['ask', 'plan', 'edit', 'debugger', 'analyzer', 'optimizer'] as const;

function sixRoleAgents(id: string): string[] {
  return id === 'ask' ? [] : S2_IDS.filter((role) => role !== id);
}

function fourRoleAgents(id: string): string[] {
  return id === 'ask' ? [] : S1_IDS.filter((role) => role !== id);
}

/**
 * Historical official user-seed generations extracted from git history of
 * `createSeedDefinition`. Numbered S0–S9 in first-seen order. Models were
 * filled from runtime routes and cannot be proven, so official fixtures use
 * empty `models` and will not match a file that recorded a concrete model.
 */
export const OFFICIAL_SEED_GENERATIONS: OfficialSeedGeneration[] = [
  {
    id: 's0',
    sourceCommit: 'c86020c432880e76ac3b4dcc98e1c4dbc2335013',
    sourcedAt: '2026-06-09',
    note: 'ask_agent / rdc-debugger specialist topology; metadata.legacyAgentRole; no icon/accent',
    manifests: S0_IDS.map((id) => seed(id, {
      name: S0_NAMES[id],
      description: S0_DESCRIPTIONS[id],
      argumentHint: id === 'ask_agent' ? askHint : missionHint,
      userInvocable: id === 'ask_agent' || id === 'rdc-debugger',
      tools: id === 'ask_agent' ? ['read', 'search', 'web'] : ['read', 'search', 'agent', 'rdx'],
      agents: id === 'rdc-debugger'
        ? S0_IDS.filter((role) => role !== 'ask_agent' && role !== 'rdc-debugger')
        : [],
      metadata: { legacyAgentRole: id },
    })),
  },
  {
    id: 's1',
    sourceCommit: '05f385aeae0a0e0b6a0f39383771e1ad8f8f26fd',
    sourcedAt: '2026-06-09',
    note: 'four ids ask/debugger/analyzer/optimizer; bash+todo; no icon/accent',
    manifests: S1_IDS.map((id) => seed(id, {
      name: names[id],
      description: descriptions[id],
      tools: id === 'ask'
        ? ['read', 'search', 'web', 'askUser']
        : ['read', 'search', 'web', 'bash', 'askUser', 'agent', 'todo', 'memory', 'rdxContext'],
      agents: fourRoleAgents(id),
    })),
  },
  {
    id: 's2',
    sourceCommit: 'd62c99b9f5ff57bea0bc7963f5b28265fd1a3223',
    sourcedAt: '2026-06-14',
    note: 'six ids with plan/edit split and plan handoff; no icon/accent',
    manifests: S2_IDS.map((id) => seed(id, {
      name: names[id],
      description: descriptions[id],
      tools: id === 'ask'
        ? ['read', 'search', 'web', 'askUser']
        : id === 'plan'
          ? ['read', 'search', 'web', 'askUser', 'agent', 'todo', 'memory', 'planArtifact', 'handoff']
          : id === 'edit'
            ? ['read', 'search', 'web', 'bash', 'write', 'edit', 'askUser', 'agent', 'todo', 'memory', 'skill', 'mcp']
            : ['read', 'search', 'web', 'bash', 'askUser', 'agent', 'todo', 'memory', 'rdxContext'],
      agents: sixRoleAgents(id),
      handoffs: id === 'plan' ? [planHandoff] : [],
    })),
  },
  {
    id: 's3',
    sourceCommit: '488c7a6e6d59dd6935e177236be19312b861ca4e',
    sourcedAt: '2026-06-18',
    note: 's2 tools plus written icon',
    manifests: S2_IDS.map((id) => seed(id, {
      name: names[id],
      description: descriptions[id],
      icon: icons[id],
      tools: id === 'ask'
        ? ['read', 'search', 'web', 'askUser']
        : id === 'plan'
          ? ['read', 'search', 'web', 'askUser', 'agent', 'todo', 'memory', 'planArtifact', 'handoff']
          : id === 'edit'
            ? ['read', 'search', 'web', 'bash', 'write', 'edit', 'askUser', 'agent', 'todo', 'memory', 'skill', 'mcp']
            : ['read', 'search', 'web', 'bash', 'askUser', 'agent', 'todo', 'memory', 'rdxContext'],
      agents: sixRoleAgents(id),
      handoffs: id === 'plan' ? [planHandoff] : [],
    })),
  },
  {
    id: 's4',
    sourceCommit: 'f5766d42175782805443340b193d9d773fcb2ac7',
    sourcedAt: '2026-07-11',
    note: 'task/tool_search/subagent/git; still bash; no file-manage/accent/output/interpreter',
    manifests: S2_IDS.map((id) => seed(id, {
      name: names[id],
      description: descriptions[id],
      icon: icons[id],
      tools: id === 'ask'
        ? ['read', 'search', 'web', 'askUser', 'task', 'tool_search']
        : id === 'plan'
          ? ['read', 'search', 'web', 'askUser', 'agent', 'task', 'memory', 'planArtifact', 'handoff', 'subagent', 'tool_search']
          : id === 'edit'
            ? ['read', 'search', 'web', 'bash', 'write', 'edit', 'git', 'askUser', 'agent', 'task', 'memory', 'skill', 'mcp', 'subagent', 'tool_search']
            : ['read', 'search', 'web', 'bash', 'askUser', 'agent', 'task', 'memory', 'rdxContext', 'subagent', 'tool_search'],
      agents: sixRoleAgents(id),
      handoffs: id === 'plan' ? [planHandoff] : [],
    })),
  },
  {
    id: 's5',
    sourceCommit: 'bb085451daa1d4238566ce6656f827e552ecda70',
    sourcedAt: '2026-07-19',
    note: 'narrow core; ask lost task; file-manage/memory-write; agent→handoff',
    manifests: S2_IDS.map((id) => seed(id, {
      name: names[id],
      description: descriptions[id],
      icon: icons[id],
      tools: id === 'ask'
        ? ['read', 'search', 'web', 'askUser', 'tool_search']
        : id === 'plan'
          ? ['read', 'search', 'web', 'askUser', 'task', 'memory', 'planArtifact', 'handoff', 'subagent', 'tool_search']
          : id === 'edit'
            ? ['read', 'search', 'web', 'bash', 'write', 'edit', 'git', 'file-manage', 'askUser', 'handoff', 'task', 'memory', 'memory-write', 'skill', 'mcp', 'subagent', 'tool_search']
            : ['read', 'search', 'web', 'bash', 'askUser', 'handoff', 'task', 'memory', 'rdxContext', 'subagent', 'tool_search'],
      agents: sixRoleAgents(id),
      handoffs: id === 'plan' ? [planHandoff] : [],
    })),
  },
  {
    id: 's6',
    sourceCommit: '648a9147d058b98de9c6ca565277ae1cd2371001',
    sourcedAt: '2026-07-21',
    note: 's5 plus written accent',
    manifests: S2_IDS.map((id) => seed(id, {
      name: names[id],
      description: descriptions[id],
      icon: icons[id],
      accent: accents[id],
      tools: id === 'ask'
        ? ['read', 'search', 'web', 'askUser', 'tool_search']
        : id === 'plan'
          ? ['read', 'search', 'web', 'askUser', 'task', 'memory', 'planArtifact', 'handoff', 'subagent', 'tool_search']
          : id === 'edit'
            ? ['read', 'search', 'web', 'bash', 'write', 'edit', 'git', 'file-manage', 'askUser', 'handoff', 'task', 'memory', 'memory-write', 'skill', 'mcp', 'subagent', 'tool_search']
            : ['read', 'search', 'web', 'bash', 'askUser', 'handoff', 'task', 'memory', 'rdxContext', 'subagent', 'tool_search'],
      agents: sixRoleAgents(id),
      handoffs: id === 'plan' ? [planHandoff] : [],
    })),
  },
  {
    id: 's7',
    sourceCommit: '572cf423bd784b6a0d42342ac28bc846f1abe43e',
    sourcedAt: '2026-07-27',
    note: 's6 plus output on edit and missions',
    manifests: S2_IDS.map((id) => seed(id, {
      name: names[id],
      description: descriptions[id],
      icon: icons[id],
      accent: accents[id],
      tools: id === 'ask'
        ? ['read', 'search', 'web', 'askUser', 'tool_search']
        : id === 'plan'
          ? ['read', 'search', 'web', 'askUser', 'task', 'memory', 'planArtifact', 'handoff', 'subagent', 'tool_search']
          : id === 'edit'
            ? ['read', 'search', 'web', 'bash', 'write', 'edit', 'git', 'file-manage', 'askUser', 'handoff', 'task', 'output', 'memory', 'memory-write', 'skill', 'mcp', 'subagent', 'tool_search']
            : ['read', 'search', 'web', 'bash', 'askUser', 'handoff', 'task', 'output', 'memory', 'rdxContext', 'subagent', 'tool_search'],
      agents: sixRoleAgents(id),
      handoffs: id === 'plan' ? [planHandoff] : [],
    })),
  },
  {
    id: 's8',
    sourceCommit: '672dd4dc831b36b7066644fac60f427e81e96784',
    sourcedAt: '2026-08-23',
    note: 's7 plus interpreter; still bash',
    manifests: S2_IDS.map((id) => seed(id, {
      name: names[id],
      description: descriptions[id],
      icon: icons[id],
      accent: accents[id],
      tools: id === 'ask'
        ? ['read', 'search', 'web', 'askUser', 'tool_search']
        : id === 'plan'
          ? ['read', 'search', 'web', 'askUser', 'task', 'memory', 'planArtifact', 'handoff', 'subagent', 'tool_search']
          : id === 'edit'
            ? ['read', 'search', 'web', 'bash', 'interpreter', 'write', 'edit', 'git', 'file-manage', 'askUser', 'handoff', 'task', 'output', 'memory', 'memory-write', 'skill', 'mcp', 'subagent', 'tool_search']
            : ['read', 'search', 'web', 'bash', 'interpreter', 'askUser', 'handoff', 'task', 'output', 'memory', 'rdxContext', 'subagent', 'tool_search'],
      agents: sixRoleAgents(id),
      handoffs: id === 'plan' ? [planHandoff] : [],
    })),
  },
  {
    id: 's9',
    sourceCommit: '7499cb25b462f5d218d6566a061dc010f1e3d067',
    sourcedAt: '2026-08-24',
    note: 'Wave 0 seed: bash replaced by shell',
    manifests: S2_IDS.map((id) => seed(id, {
      name: names[id],
      description: descriptions[id],
      icon: icons[id],
      accent: accents[id],
      tools: id === 'ask'
        ? ['read', 'search', 'web', 'askUser', 'tool_search']
        : id === 'plan'
          ? ['read', 'search', 'web', 'askUser', 'task', 'memory', 'planArtifact', 'handoff', 'subagent', 'tool_search']
          : id === 'edit'
            ? ['read', 'search', 'web', 'shell', 'interpreter', 'write', 'edit', 'git', 'file-manage', 'askUser', 'handoff', 'task', 'output', 'memory', 'memory-write', 'skill', 'mcp', 'subagent', 'tool_search']
            : ['read', 'search', 'web', 'shell', 'interpreter', 'askUser', 'handoff', 'task', 'output', 'memory', 'rdxContext', 'subagent', 'tool_search'],
      agents: sixRoleAgents(id),
      handoffs: id === 'plan' ? [planHandoff] : [],
    })),
  },
];

export function expandOfficialS0IdAliases(id: string): string[] {
  const hyphen = id.replace(/_/g, '-');
  const underscore = id.replace(/-/g, '_');
  const official = S0_IDS.find((entry) => entry === id || entry === hyphen || entry === underscore);
  if (!official) return [];
  return [...new Set([official, official.replace(/_/g, '-'), official.replace(/-/g, '_')])];
}

export const HISTORICAL_TOP_LEVEL_AGENT_IDS = ['ask', 'plan', 'edit'] as const;

export function historicalReservedAgentIds(): Set<string> {
  const ids = new Set<string>(HISTORICAL_TOP_LEVEL_AGENT_IDS);
  for (const id of OFFICIAL_S0_SEED_IDS) {
    ids.add(id);
    for (const alias of expandOfficialS0IdAliases(id)) {
      ids.add(alias);
    }
  }
  return ids;
}

/** Shared reserved set for migration, manifest snapshot, tests, and check:settings-agents. */
export const HISTORICAL_RESERVED_AGENT_IDS: ReadonlySet<string> = historicalReservedAgentIds();

export function isHistoricalReservedAgentId(id: string): boolean {
  return HISTORICAL_RESERVED_AGENT_IDS.has(id);
}

export function officialSeedIdentitySet(): Set<string> {
  const ids = new Set<string>();
  for (const generation of OFFICIAL_SEED_GENERATIONS) {
    for (const manifest of generation.manifests) {
      ids.add(manifest.id);
      for (const alias of expandOfficialS0IdAliases(manifest.id)) {
        ids.add(alias);
      }
    }
  }
  return ids;
}

export function officialSeedHashIndex(): Map<string, { generationId: string; manifest: SeedSemanticManifest }> {
  const index = new Map<string, { generationId: string; manifest: SeedSemanticManifest }>();
  for (const generation of OFFICIAL_SEED_GENERATIONS) {
    for (const manifest of generation.manifests) {
      index.set(hashSeedSemanticManifest(manifest), { generationId: generation.id, manifest });
    }
  }
  return index;
}

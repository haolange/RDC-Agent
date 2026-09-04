import { createHash } from 'crypto';
import YAML from 'yaml';

export interface SeedSemanticHandoff {
  label: string;
  agent: string;
  prompt: string;
  send?: boolean;
  showContinueOn?: boolean;
  model?: string;
}

/** Parse-after semantic payload used to recognize official historical user seeds. */
export interface SeedSemanticManifest {
  id: string;
  name: string;
  description: string;
  argumentHint: string;
  target: string;
  models: string[];
  icon: string | null;
  accent: string | null;
  enabled: boolean;
  userInvocable: boolean;
  disableModelInvocation: boolean;
  maxTurns: number | null;
  tools: string[];
  skills: string[];
  mcpServers: string[];
  agents: string[];
  handoffs: SeedSemanticHandoff[];
  metadata: Record<string, unknown>;
  instructions: string;
}

const readStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.trim()).filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }
  return [];
};

const readBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;

const stableSerialize = (value: unknown): string => {
  if (value === undefined) return 'undefined';
  if (typeof value === 'bigint') return `${value.toString()}n`;
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? String(value);
};

const readHandoffs = (value: unknown): SeedSemanticHandoff[] => {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const candidate = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {};
    const handoff: SeedSemanticHandoff = {
      label: typeof candidate.label === 'string' ? candidate.label.trim() : '',
      agent: typeof candidate.agent === 'string' ? candidate.agent.trim() : '',
      prompt: typeof candidate.prompt === 'string' ? candidate.prompt.trim() : '',
    };
    if (typeof candidate.send === 'boolean') handoff.send = candidate.send;
    if (typeof candidate.showContinueOn === 'boolean') handoff.showContinueOn = candidate.showContinueOn;
    if (typeof candidate.model === 'string' && candidate.model.trim()) handoff.model = candidate.model.trim();
    return handoff;
  });
};

export function readSeedFrontmatterId(rawContent: string): string | null {
  const raw = rawContent.replace(/^\uFEFF/u, '');
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u.exec(raw);
  if (!match) return null;
  const frontmatter = YAML.parse(match[1]) as Record<string, unknown> | null;
  const id = typeof frontmatter?.id === 'string' ? frontmatter.id.trim() : '';
  return id || null;
}

export function extractSeedSemanticManifest(rawContent: string, id: string): SeedSemanticManifest {
  const raw = rawContent.replace(/^\uFEFF/u, '');
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u.exec(raw);
  const frontmatter = match ? YAML.parse(match[1]) as Record<string, unknown> : {};
  const instructions = match ? match[2].trim() : raw.trim();
  const name = typeof frontmatter.name === 'string' && frontmatter.name.trim()
    ? frontmatter.name.trim()
    : id;
  return {
    id,
    name,
    description: typeof frontmatter.description === 'string' ? frontmatter.description.trim() : '',
    argumentHint: typeof frontmatter['argument-hint'] === 'string' ? frontmatter['argument-hint'].trim() : '',
    target: typeof frontmatter.target === 'string' ? frontmatter.target.trim() : 'rdc-agent',
    models: readStringArray(frontmatter.model),
    icon: typeof frontmatter.icon === 'string' && frontmatter.icon.trim() ? frontmatter.icon.trim() : null,
    accent: typeof frontmatter.accent === 'string' && frontmatter.accent.trim() ? frontmatter.accent.trim() : null,
    enabled: readBoolean(frontmatter.enabled, true),
    userInvocable: readBoolean(frontmatter['user-invocable'], true),
    disableModelInvocation: readBoolean(frontmatter['disable-model-invocation'], false),
    maxTurns: typeof frontmatter['max-turns'] === 'number' && frontmatter['max-turns'] > 0
      ? frontmatter['max-turns']
      : null,
    tools: readStringArray(frontmatter.tools),
    skills: readStringArray(frontmatter.skills),
    mcpServers: readStringArray(frontmatter['mcp-servers']),
    agents: readStringArray(frontmatter.agents),
    handoffs: readHandoffs(frontmatter.handoffs),
    metadata: frontmatter.metadata && typeof frontmatter.metadata === 'object'
      ? frontmatter.metadata as Record<string, unknown>
      : {},
    instructions,
  };
}

export function hashSeedSemanticManifest(manifest: SeedSemanticManifest): string {
  return createHash('sha256').update(stableSerialize({
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    argumentHint: manifest.argumentHint,
    target: manifest.target,
    models: manifest.models,
    icon: manifest.icon,
    accent: manifest.accent,
    enabled: manifest.enabled,
    userInvocable: manifest.userInvocable,
    disableModelInvocation: manifest.disableModelInvocation,
    maxTurns: manifest.maxTurns,
    tools: manifest.tools,
    skills: manifest.skills,
    mcpServers: manifest.mcpServers,
    agents: manifest.agents,
    handoffs: manifest.handoffs,
    metadata: manifest.metadata,
    instructions: manifest.instructions,
  }), 'utf8').digest('hex');
}

/** Canonical identity for shadow vs override. Excludes only top-level models/icon/accent and handoffs[*].model. */
export function hashCanonicalAgentSemantics(manifest: SeedSemanticManifest): string {
  return createHash('sha256').update(stableSerialize({
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    argumentHint: manifest.argumentHint,
    target: manifest.target,
    enabled: manifest.enabled,
    userInvocable: manifest.userInvocable,
    disableModelInvocation: manifest.disableModelInvocation,
    maxTurns: manifest.maxTurns,
    tools: manifest.tools,
    skills: manifest.skills,
    mcpServers: manifest.mcpServers,
    agents: manifest.agents,
    handoffs: manifest.handoffs.map((handoff) => ({
      label: handoff.label,
      agent: handoff.agent,
      prompt: handoff.prompt,
      ...(typeof handoff.send === 'boolean' ? { send: handoff.send } : {}),
      ...(typeof handoff.showContinueOn === 'boolean' ? { showContinueOn: handoff.showContinueOn } : {}),
    })),
    metadata: manifest.metadata,
    instructions: manifest.instructions,
  }), 'utf8').digest('hex');
}

import path from 'path';
import YAML from 'yaml';
import { diagnoseManifestToolTokens } from '@shared/constants/agentToolTokens';
import { isAgentIconPreset } from '@shared/constants/agents';
import type { AgentHandoffDefinition, AgentManifestDefinition, AgentManifestDraft } from '@shared/types/agentManifest';
import { COMPOSE_ACCENT_FALLBACK, normalizeAgentAccent } from '@shared/theme/composeAccent';

export interface ManifestParseOk {
  ok: true;
  definition: AgentManifestDefinition;
}

export interface ManifestParseInvalid {
  ok: false;
  reason: string;
}

export type ManifestParseResult = ManifestParseOk | ManifestParseInvalid;

const readStringArray = (value: unknown): string[] | null => {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) {
    if (value.some((entry) => typeof entry !== 'string')) return null;
    return value.map((entry) => entry.trim()).filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return null;
};

const readBoolean = (value: unknown, fallback: boolean): boolean | null => {
  if (value === undefined) return fallback;
  return typeof value === 'boolean' ? value : null;
};

const readHandoffsStrict = (value: unknown): AgentHandoffDefinition[] | string => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return 'handoffs must be an array when present.';
  const handoffs: AgentHandoffDefinition[] = [];
  for (const [index, entry] of value.entries()) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return `handoffs[${index}] must be an object.`;
    }
    const candidate = entry as Record<string, unknown>;
    const label = typeof candidate.label === 'string' ? candidate.label.trim() : '';
    const agent = typeof candidate.agent === 'string' ? candidate.agent.trim() : '';
    const prompt = typeof candidate.prompt === 'string' ? candidate.prompt.trim() : '';
    if (!label || !agent || !prompt) {
      return `handoffs[${index}] requires non-empty label, agent, and prompt.`;
    }
    if (candidate.send !== undefined && typeof candidate.send !== 'boolean') {
      return `handoffs[${index}].send must be a boolean.`;
    }
    if (candidate.showContinueOn !== undefined && typeof candidate.showContinueOn !== 'boolean') {
      return `handoffs[${index}].showContinueOn must be a boolean.`;
    }
    if (candidate.model !== undefined && (typeof candidate.model !== 'string' || !candidate.model.trim())) {
      return `handoffs[${index}].model must be a non-empty string when present.`;
    }
    const requiredSkillIds = readStringArray(candidate.requiredSkillIds);
    if (requiredSkillIds === null) {
      return `handoffs[${index}].requiredSkillIds must be a string array when present.`;
    }
    const handoff: AgentHandoffDefinition = { label, agent, prompt };
    if (typeof candidate.send === 'boolean') handoff.send = candidate.send;
    if (typeof candidate.showContinueOn === 'boolean') handoff.showContinueOn = candidate.showContinueOn;
    if (typeof candidate.model === 'string' && candidate.model.trim()) handoff.model = candidate.model.trim();
    if (requiredSkillIds.length > 0) handoff.requiredSkillIds = requiredSkillIds;
    handoffs.push(handoff);
  }
  return handoffs;
};

export function parseAgentMarkdownStrict(
  rawContent: string,
  filePath: string,
  fallbackId: string,
  updatedAt: string,
  builtin: boolean,
): ManifestParseResult {
  try {
    const raw = rawContent.replace(/^\uFEFF/u, '');
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u.exec(raw);
    if (!match) {
      return { ok: false, reason: 'Manifest must use YAML frontmatter delimited by ---.' };
    }
    const frontmatter = YAML.parse(match[1]) as unknown;
    if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) {
      return { ok: false, reason: 'Manifest frontmatter must be a YAML object.' };
    }
    const record = frontmatter as Record<string, unknown>;
    const name = typeof record.name === 'string' && record.name.trim() ? record.name.trim() : fallbackId;
    const tools = readStringArray(record.tools);
    const skills = readStringArray(record.skills);
    const mcpServers = readStringArray(record['mcp-servers']);
    const agents = readStringArray(record.agents);
    const models = readStringArray(record.model);
    const enabled = readBoolean(record.enabled, true);
    const userInvocable = readBoolean(record['user-invocable'], true);
    const disableModelInvocation = readBoolean(record['disable-model-invocation'], false);
    if (!tools || !skills || !mcpServers || !agents || !models) {
      return { ok: false, reason: 'tools/skills/mcp-servers/agents/model must be string arrays when present.' };
    }
    if (enabled === null || userInvocable === null || disableModelInvocation === null) {
      return { ok: false, reason: 'enabled/user-invocable/disable-model-invocation must be booleans when present.' };
    }
    const handoffs = readHandoffsStrict(record.handoffs);
    if (typeof handoffs === 'string') {
      return { ok: false, reason: handoffs };
    }
    const tokenDiagnostics = diagnoseManifestToolTokens(tools);
    if (tokenDiagnostics.length > 0) {
      return {
        ok: false,
        reason: tokenDiagnostics.map((entry) => `${entry.token}: ${entry.message}`).join('; '),
      };
    }
    if (record['max-turns'] !== undefined && (typeof record['max-turns'] !== 'number' || record['max-turns'] <= 0)) {
      return { ok: false, reason: 'max-turns must be a positive number when present.' };
    }
    return {
      ok: true,
      definition: {
        id: fallbackId,
        fileName: path.basename(filePath),
        filePath,
        name,
        description: typeof record.description === 'string' ? record.description.trim() : '',
        argumentHint: typeof record['argument-hint'] === 'string' ? record['argument-hint'].trim() : '',
        target: typeof record.target === 'string' && record.target.trim() ? record.target.trim() : 'rdc-agent',
        models,
        icon: isAgentIconPreset(record.icon) ? record.icon : 'message-orbit',
        accent: normalizeAgentAccent(record.accent, COMPOSE_ACCENT_FALLBACK),
        disableModelInvocation,
        userInvocable,
        tools,
        skills,
        mcpServers,
        agents,
        handoffs,
        metadata: record.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata)
          ? record.metadata as Record<string, unknown>
          : {},
        instructions: match[2].trim(),
        builtin,
        enabled,
        maxTurns: typeof record['max-turns'] === 'number' && record['max-turns'] > 0 ? record['max-turns'] : undefined,
        updatedAt,
      },
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export function serializeAgentMarkdown(definition: AgentManifestDraft): string {
  const frontmatter: Record<string, unknown> = {
    name: definition.name,
    description: definition.description,
    'argument-hint': definition.argumentHint,
    target: definition.target || 'rdc-agent',
    model: definition.models,
    icon: isAgentIconPreset(definition.icon) ? definition.icon : 'message-orbit',
    accent: normalizeAgentAccent(definition.accent, COMPOSE_ACCENT_FALLBACK),
    'disable-model-invocation': definition.disableModelInvocation,
    'user-invocable': definition.userInvocable,
    enabled: definition.enabled,
    ...(definition.maxTurns ? { 'max-turns': definition.maxTurns } : {}),
    tools: definition.tools,
    skills: definition.skills,
    'mcp-servers': definition.mcpServers,
    agents: definition.agents,
    handoffs: definition.handoffs,
    metadata: definition.metadata,
  };
  return `---\n${YAML.stringify(frontmatter).trim()}\n---\n\n${definition.instructions.trim()}\n`;
}

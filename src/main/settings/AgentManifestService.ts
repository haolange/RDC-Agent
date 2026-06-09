import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import type { AgentRole } from '@shared/types/agent';
import type {
  AgentHandoffDefinition,
  AgentManifestDefinition,
  AgentManifestDraft,
  AgentManifestSettings,
  AgentModelOption,
} from '@shared/types/agentManifest';
import type { AppRuntimePaths, LlmAgentRoute, LlmProviderEntry } from '@shared/types/settings';
import { AGENT_DESCRIPTIONS, AGENT_DISPLAY_NAMES, AGENT_ROLES } from '@shared/constants/agents';

const GLOBAL_INSTRUCTIONS_FILE = 'global-instructions.md';

const toSlug = (value: string): string => {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'agent';
};

const fileNameForId = (id: string): string => `${toSlug(id.replace(/_/g, '-'))}.agent.md`;

const canonicalModelId = (providerId: string, modelId: string): string =>
  providerId && modelId ? `${providerId}:${modelId}` : '';

const splitCanonicalModelId = (value: string): { providerId: string; modelId: string } | null => {
  const separator = value.indexOf(':');
  if (separator <= 0 || separator === value.length - 1) {
    return null;
  }
  return {
    providerId: value.slice(0, separator),
    modelId: value.slice(separator + 1),
  };
};

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

const readHandoffs = (value: unknown): AgentHandoffDefinition[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const handoffs: AgentHandoffDefinition[] = [];
  for (const entry of value) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }
      const candidate = entry as Record<string, unknown>;
      const label = typeof candidate.label === 'string' ? candidate.label.trim() : '';
      const agent = typeof candidate.agent === 'string' ? candidate.agent.trim() : '';
      const prompt = typeof candidate.prompt === 'string' ? candidate.prompt.trim() : '';
      if (!label || !agent || !prompt) {
        continue;
      }
      const handoff: AgentHandoffDefinition = {
        label,
        agent,
        prompt,
      };
      if (typeof candidate.send === 'boolean') {
        handoff.send = candidate.send;
      }
      if (typeof candidate.showContinueOn === 'boolean') {
        handoff.showContinueOn = candidate.showContinueOn;
      }
      handoffs.push(handoff);
  }
  return handoffs;
};

const parseAgentMarkdown = (filePath: string, fallbackId: string): AgentManifestDefinition => {
  const raw = fs.readFileSync(filePath, 'utf8');
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u.exec(raw);
  const frontmatter = match ? YAML.parse(match[1]) as Record<string, unknown> : {};
  const instructions = match ? match[2].trim() : raw.trim();
  const name = typeof frontmatter.name === 'string' && frontmatter.name.trim()
    ? frontmatter.name.trim()
    : fallbackId;
  const id = typeof frontmatter.id === 'string' && frontmatter.id.trim()
    ? frontmatter.id.trim()
    : fallbackId;

  return {
    id,
    fileName: path.basename(filePath),
    filePath,
    name,
    description: typeof frontmatter.description === 'string' ? frontmatter.description.trim() : '',
    argumentHint: typeof frontmatter['argument-hint'] === 'string' ? frontmatter['argument-hint'].trim() : '',
    target: typeof frontmatter.target === 'string' ? frontmatter.target.trim() : 'rdc-agent',
    models: readStringArray(frontmatter.model),
    disableModelInvocation: readBoolean(frontmatter['disable-model-invocation'], false),
    userInvocable: readBoolean(frontmatter['user-invocable'], true),
    tools: readStringArray(frontmatter.tools),
    skills: readStringArray(frontmatter.skills),
    mcpServers: readStringArray(frontmatter.mcpServers),
    agents: readStringArray(frontmatter.agents),
    handoffs: readHandoffs(frontmatter.handoffs),
    metadata: frontmatter.metadata && typeof frontmatter.metadata === 'object'
      ? frontmatter.metadata as Record<string, unknown>
      : {},
    instructions,
    builtin: false,
    enabled: readBoolean(frontmatter.enabled, true),
    updatedAt: fs.statSync(filePath).mtime.toISOString(),
  };
};

const serializeAgentMarkdown = (definition: AgentManifestDraft): string => {
  const frontmatter: Record<string, unknown> = {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    'argument-hint': definition.argumentHint,
    target: definition.target || 'rdc-agent',
    model: definition.models,
    'disable-model-invocation': definition.disableModelInvocation,
    'user-invocable': definition.userInvocable,
    enabled: definition.enabled,
    tools: definition.tools,
    skills: definition.skills,
    mcpServers: definition.mcpServers,
    agents: definition.agents,
    handoffs: definition.handoffs,
    metadata: definition.metadata,
  };
  return `---\n${YAML.stringify(frontmatter).trim()}\n---\n\n${definition.instructions.trim()}\n`;
};

const createSeedDefinition = (
  agentId: AgentRole,
  routes: LlmAgentRoute[],
): AgentManifestDraft => {
  const route = routes.find((entry) => entry.agentId === agentId);
  const model = canonicalModelId(route?.providerId ?? '', route?.modelId ?? '');
  const name = AGENT_DISPLAY_NAMES[agentId];
  return {
    id: agentId,
    fileName: fileNameForId(agentId),
    name,
    description: AGENT_DESCRIPTIONS[agentId],
    argumentHint: agentId === 'ask_agent'
      ? 'Ask about the current project, capture, or workflow'
      : 'Describe the RenderDoc/RDC investigation goal',
    target: 'rdc-agent',
    models: model ? [model] : [],
    disableModelInvocation: false,
    userInvocable: agentId === 'ask_agent' || agentId === 'rdc-debugger',
    tools: agentId === 'ask_agent'
      ? ['read', 'search', 'web']
      : ['read', 'search', 'agent', 'rdx'],
    skills: [],
    mcpServers: [],
    agents: agentId === 'rdc-debugger'
      ? AGENT_ROLES.filter((role) => role !== 'ask_agent' && role !== 'rdc-debugger')
      : [],
    handoffs: [],
    metadata: {
      legacyAgentRole: agentId,
    },
    instructions: `You are ${name}. ${AGENT_DESCRIPTIONS[agentId]}.`,
    enabled: true,
  };
};

export class AgentManifestService {
  private getAgentsDirectory(paths: Pick<AppRuntimePaths, 'profilesPath'>): string {
    return path.join(paths.profilesPath, 'agents');
  }

  private getGlobalInstructionsPath(paths: Pick<AppRuntimePaths, 'profilesPath'>): string {
    return path.join(paths.profilesPath, GLOBAL_INSTRUCTIONS_FILE);
  }

  ensureSeedManifests(paths: Pick<AppRuntimePaths, 'profilesPath'>, routes: LlmAgentRoute[]): void {
    const directory = this.getAgentsDirectory(paths);
    fs.mkdirSync(directory, { recursive: true });
    const hasManifest = fs.readdirSync(directory).some((entry) => entry.endsWith('.agent.md'));
    if (hasManifest) {
      return;
    }
    for (const agentId of AGENT_ROLES) {
      const seed = createSeedDefinition(agentId, routes);
      fs.writeFileSync(path.join(directory, seed.fileName), serializeAgentMarkdown(seed), 'utf8');
    }
  }

  getSettings(
    paths: Pick<AppRuntimePaths, 'profilesPath'>,
    providers: LlmProviderEntry[],
    routes: LlmAgentRoute[],
  ): AgentManifestSettings {
    this.ensureSeedManifests(paths, routes);
    const directoryPath = this.getAgentsDirectory(paths);
    const definitions = fs.readdirSync(directoryPath)
      .filter((entry) => entry.endsWith('.agent.md'))
      .map((entry) => {
        const fullPath = path.join(directoryPath, entry);
        const fallbackId = entry.replace(/\.agent\.md$/u, '');
        return parseAgentMarkdown(fullPath, fallbackId);
      })
      .sort((left, right) => Number(right.userInvocable) - Number(left.userInvocable) || left.name.localeCompare(right.name));

    return {
      directoryPath,
      definitions,
      modelOptions: this.getModelOptions(providers),
      globalInstructions: this.readGlobalInstructions(paths),
    };
  }

  save(
    paths: Pick<AppRuntimePaths, 'profilesPath'>,
    drafts: AgentManifestDraft[],
    globalInstructions?: string,
  ): void {
    const directory = this.getAgentsDirectory(paths);
    fs.mkdirSync(directory, { recursive: true });
    for (const draft of drafts) {
      const fileName = draft.fileName && draft.fileName.endsWith('.agent.md')
        ? draft.fileName
        : fileNameForId(draft.id || draft.name);
      const filePath = path.join(directory, fileName);
      if (draft.delete) {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        continue;
      }
      fs.writeFileSync(filePath, serializeAgentMarkdown({
        ...draft,
        id: draft.id || toSlug(draft.name),
        fileName,
      }), 'utf8');
    }

    if (typeof globalInstructions === 'string') {
      fs.writeFileSync(this.getGlobalInstructionsPath(paths), globalInstructions.trim(), 'utf8');
    }
  }

  importFile(paths: Pick<AppRuntimePaths, 'profilesPath'>, sourcePath: string): AgentManifestDefinition {
    if (!sourcePath.endsWith('.agent.md')) {
      throw new Error('Only .agent.md files can be imported.');
    }
    if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
      throw new Error(`Agent manifest not found: ${sourcePath}`);
    }
    const directory = this.getAgentsDirectory(paths);
    fs.mkdirSync(directory, { recursive: true });
    const imported = parseAgentMarkdown(sourcePath, path.basename(sourcePath, '.agent.md'));
    const fileName = fileNameForId(imported.id || imported.name);
    const targetPath = path.join(directory, fileName);
    fs.copyFileSync(sourcePath, targetPath);
    return parseAgentMarkdown(targetPath, fileName.replace(/\.agent\.md$/u, ''));
  }

  routesFromDefinitions(
    currentRoutes: LlmAgentRoute[],
    definitions: AgentManifestDraft[],
  ): LlmAgentRoute[] {
    const routeMap = new Map(currentRoutes.map((route) => [route.agentId, route]));
    const knownAgentIds = new Set<string>(AGENT_ROLES);
    for (const definition of definitions) {
      if (!knownAgentIds.has(definition.id) || definition.delete) {
        continue;
      }
      const model = definition.models.map(splitCanonicalModelId).find((entry) => entry !== null);
      if (!model) {
        continue;
      }
      routeMap.set(definition.id as AgentRole, {
        agentId: definition.id as AgentRole,
        providerId: model.providerId,
        modelId: model.modelId,
      });
    }
    return AGENT_ROLES.map((agentId) => routeMap.get(agentId) ?? {
      agentId,
      providerId: '',
      modelId: '',
    });
  }

  private getModelOptions(providers: LlmProviderEntry[]): AgentModelOption[] {
    return providers.flatMap((provider) => provider.models.map((model) => ({
      canonicalId: canonicalModelId(provider.id, model.id),
      providerId: provider.id,
      providerLabel: provider.label,
      modelId: model.id,
      modelLabel: model.label || model.id,
      configured: provider.enabled && provider.isConfigured && model.enabled !== false,
    })));
  }

  private readGlobalInstructions(paths: Pick<AppRuntimePaths, 'profilesPath'>): string {
    const filePath = this.getGlobalInstructionsPath(paths);
    if (!fs.existsSync(filePath)) {
      return '';
    }
    return fs.readFileSync(filePath, 'utf8');
  }
}

export const agentManifestService = new AgentManifestService();

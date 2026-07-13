import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import type { AgentId } from '@shared/types/agent';
import { isSafeAgentProfileId } from '@shared/types/agent';
import type {
  AgentHandoffDefinition,
  AgentManifestDefinition,
  AgentManifestDraft,
  AgentManifestSettings,
  AgentModelOption,
} from '@shared/types/agentManifest';
import type { AppRuntimePaths, LlmAgentRoute, LlmProviderEntry } from '@shared/types/settings';
import type { EffectiveAgentProfile, ScopedResourceCandidate } from '@shared/types/rdxRuntime';
import { AGENT_DESCRIPTIONS, AGENT_DISPLAY_NAMES, AGENT_MODE_MAP, AGENT_ROLES, isAgentIconPreset } from '@shared/constants/agents';
import { canonicalAgentModelId, splitCanonicalAgentModelId } from '@shared/utils/agentModelRoute';
import { appPathService } from '../runtime/AppPathService';
import { scopedResourceResolver } from '../runtime/ScopedResourceResolver';

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

const idFromFileName = (fileName: string): string => fileName.replace(/\.agent\.md$/u, '');

const safeFileNameForDraft = (draft: Pick<AgentManifestDraft, 'id' | 'name' | 'fileName'>): string => {
  const agentId = draft.id || toSlug(draft.name);
  if (!isSafeAgentProfileId(agentId)) {
    throw new Error(`Invalid agent profile id: ${agentId}`);
  }
  const candidate = draft.fileName && draft.fileName.endsWith('.agent.md')
    ? path.basename(draft.fileName)
    : fileNameForId(agentId);
  const candidateId = idFromFileName(candidate);
  return candidateId === agentId && isSafeAgentProfileId(candidateId) ? candidate : fileNameForId(agentId);
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
      if (typeof candidate.model === 'string' && candidate.model.trim()) {
        handoff.model = candidate.model.trim();
      }
      handoffs.push(handoff);
  }
  return handoffs;
};

const parseAgentMarkdown = (filePath: string, fallbackId: string): AgentManifestDefinition => {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/u, '');
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u.exec(raw);
  const frontmatter = match ? YAML.parse(match[1]) as Record<string, unknown> : {};
  const instructions = match ? match[2].trim() : raw.trim();
  const name = typeof frontmatter.name === 'string' && frontmatter.name.trim()
    ? frontmatter.name.trim()
    : fallbackId;
  return {
    id: fallbackId,
    fileName: path.basename(filePath),
    filePath,
    name,
    description: typeof frontmatter.description === 'string' ? frontmatter.description.trim() : '',
    argumentHint: typeof frontmatter['argument-hint'] === 'string' ? frontmatter['argument-hint'].trim() : '',
    target: typeof frontmatter.target === 'string' ? frontmatter.target.trim() : 'rdc-agent',
    models: readStringArray(frontmatter.model),
    icon: isAgentIconPreset(frontmatter.icon) ? frontmatter.icon : AGENT_MODE_MAP[fallbackId]?.icon ?? 'message-orbit',
    disableModelInvocation: readBoolean(frontmatter['disable-model-invocation'], false),
    userInvocable: readBoolean(frontmatter['user-invocable'], true),
    tools: readStringArray(frontmatter.tools),
    skills: readStringArray(frontmatter.skills),
    mcpServers: readStringArray(frontmatter['mcp-servers']),
    agents: readStringArray(frontmatter.agents),
    handoffs: readHandoffs(frontmatter.handoffs),
    metadata: frontmatter.metadata && typeof frontmatter.metadata === 'object'
      ? frontmatter.metadata as Record<string, unknown>
      : {},
    instructions,
    builtin: false,
    enabled: readBoolean(frontmatter.enabled, true),
    maxTurns: typeof frontmatter['max-turns'] === 'number' && frontmatter['max-turns'] > 0
      ? frontmatter['max-turns']
      : undefined,
    updatedAt: fs.statSync(filePath).mtime.toISOString(),
  };
};

const serializeAgentMarkdown = (definition: AgentManifestDraft): string => {
  const frontmatter: Record<string, unknown> = {
    name: definition.name,
    description: definition.description,
    'argument-hint': definition.argumentHint,
    target: definition.target || 'rdc-agent',
    model: definition.models,
    icon: isAgentIconPreset(definition.icon) ? definition.icon : 'message-orbit',
    'disable-model-invocation': definition.disableModelInvocation,
    'user-invocable': definition.userInvocable,
    enabled: definition.enabled,
    ...(definition.maxTurns ? { 'max-turns': definition.maxTurns } : {}),
    tools: definition.tools,
    skills: definition.skills,
    'mcp-servers': definition.mcpServers,
    agents: definition.agents,
    handoffs: definition.handoffs,
  };
  return `---\n${YAML.stringify(frontmatter).trim()}\n---\n\n${definition.instructions.trim()}\n`;
};

const createSeedDefinition = (
  agentId: AgentId,
  routes: LlmAgentRoute[],
): AgentManifestDraft => {
  const route = routes.find((entry) => entry.agentId === agentId);
  const model = canonicalAgentModelId(route?.providerId ?? '', route?.modelId ?? '');
  const name = AGENT_DISPLAY_NAMES[agentId];
  const tools = agentId === 'ask'
    ? ['read', 'search', 'web', 'askUser', 'task', 'tool_search']
    : agentId === 'plan'
      ? ['read', 'search', 'web', 'askUser', 'agent', 'task', 'memory', 'planArtifact', 'handoff', 'subagent', 'tool_search']
      : agentId === 'edit'
        ? ['read', 'search', 'web', 'bash', 'write', 'edit', 'git', 'askUser', 'agent', 'task', 'memory', 'skill', 'mcp', 'subagent', 'tool_search']
        : ['read', 'search', 'web', 'bash', 'askUser', 'agent', 'task', 'memory', 'rdxContext', 'subagent', 'tool_search'];
  return {
    id: agentId,
    fileName: fileNameForId(agentId),
    name,
    description: AGENT_DESCRIPTIONS[agentId],
    argumentHint: agentId === 'ask'
      ? 'Ask about the current project, capture, or workflow'
      : 'Describe the RenderDoc/RDC investigation goal',
    target: 'rdc-agent',
    models: model ? [model] : [],
    icon: AGENT_MODE_MAP[agentId]?.icon ?? 'message-orbit',
    disableModelInvocation: false,
    userInvocable: true,
    tools,
    skills: [],
    mcpServers: [],
    agents: agentId === 'ask' ? [] : AGENT_ROLES.filter((role) => role !== agentId),
    handoffs: agentId === 'plan'
      ? [
          {
            label: 'Start Implementation',
            agent: 'edit',
            prompt: 'Start implementing the approved plan.',
          },
        ]
      : [],
    metadata: {},
    instructions: `You are ${name}. ${AGENT_DESCRIPTIONS[agentId]}.`,
    enabled: true,
  };
};

export class AgentManifestService {
  private getAgentsDirectory(paths: Pick<AppRuntimePaths, 'agentsPath'>): string {
    return paths.agentsPath;
  }

  private getGlobalInstructionsPath(paths: Pick<AppRuntimePaths, 'instructionsPath'>): string {
    return paths.instructionsPath;
  }

  ensureSeedManifests(paths: Pick<AppRuntimePaths, 'agentsPath' | 'instructionsPath'>, routes: LlmAgentRoute[]): void {
    const directory = this.getAgentsDirectory(paths);
    fs.mkdirSync(directory, { recursive: true });
    const existing = new Set(fs.readdirSync(directory));
    for (const agentId of AGENT_ROLES) {
      const seed = createSeedDefinition(agentId, routes);
      if (!existing.has(seed.fileName)) {
        fs.writeFileSync(path.join(directory, seed.fileName), serializeAgentMarkdown(seed), 'utf8');
      }
    }
  }

  getSettings(
    paths: Pick<AppRuntimePaths, 'agentsPath' | 'instructionsPath'>,
    providers: LlmProviderEntry[],
    routes: LlmAgentRoute[],
  ): AgentManifestSettings {
    this.ensureSeedManifests(paths, routes);
    const directoryPath = this.getAgentsDirectory(paths);
    const definitions = fs.readdirSync(directoryPath)
      .filter((entry) => entry.endsWith('.agent.md'))
      .filter((entry) => isSafeAgentProfileId(idFromFileName(entry)))
      .map((entry) => {
        const fullPath = path.join(directoryPath, entry);
        const fallbackId = idFromFileName(entry);
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

  getEffectiveProfiles(
    paths: Pick<AppRuntimePaths, 'agentsPath' | 'instructionsPath'>,
    providers: LlmProviderEntry[],
    routes: LlmAgentRoute[],
    projectRoot?: string,
  ): EffectiveAgentProfile[] {
    const userSettings = this.getSettings(paths, providers, routes);
    const candidates: Array<ScopedResourceCandidate<AgentManifestDefinition>> = userSettings.definitions.map((definition) => ({
      id: definition.id,
      kind: 'agent',
      scope: 'user',
      sourcePath: definition.filePath,
      value: definition,
      enabled: definition.enabled,
    }));

    if (projectRoot) {
      const projectAgentsPath = appPathService.getProjectRdxPaths(projectRoot).agentsPath;
      if (fs.existsSync(projectAgentsPath)) {
        fs.readdirSync(projectAgentsPath)
          .filter((entry) => entry.endsWith('.agent.md'))
          .filter((entry) => isSafeAgentProfileId(idFromFileName(entry)))
          .forEach((entry) => {
            const filePath = path.join(projectAgentsPath, entry);
            const definition = parseAgentMarkdown(filePath, idFromFileName(entry));
            candidates.push({
              id: definition.id,
              kind: 'agent',
              scope: 'project',
              sourcePath: filePath,
              value: definition,
              enabled: definition.enabled,
            });
          });
      }
    }

    return scopedResourceResolver.resolve(candidates).resources.map((resource) => ({
      ...resource.value,
      effectiveStatus: resource.effectiveStatus,
      provenance: resource.provenance,
    }));
  }

  save(
    paths: Pick<AppRuntimePaths, 'agentsPath' | 'instructionsPath'>,
    drafts: AgentManifestDraft[],
    globalInstructions?: string,
  ): void {
    const directory = this.getAgentsDirectory(paths);
    fs.mkdirSync(directory, { recursive: true });
    for (const draft of drafts) {
      const agentId = draft.id || toSlug(draft.name);
      if (!isSafeAgentProfileId(agentId)) {
        throw new Error(`Invalid agent profile id: ${agentId}`);
      }
      const fileName = safeFileNameForDraft(draft);
      const filePath = path.join(directory, fileName);
      if (draft.delete) {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        continue;
      }
      fs.writeFileSync(filePath, serializeAgentMarkdown({
        ...draft,
        id: agentId,
        fileName,
      }), 'utf8');
    }

    if (typeof globalInstructions === 'string') {
      fs.writeFileSync(this.getGlobalInstructionsPath(paths), globalInstructions.trim(), 'utf8');
    }
  }

  importFile(paths: Pick<AppRuntimePaths, 'agentsPath' | 'instructionsPath'>, sourcePath: string): AgentManifestDefinition {
    if (!sourcePath.endsWith('.agent.md')) {
      throw new Error('Only .agent.md files can be imported.');
    }
    if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
      throw new Error(`Agent manifest not found: ${sourcePath}`);
    }
    const directory = this.getAgentsDirectory(paths);
    fs.mkdirSync(directory, { recursive: true });
    const imported = parseAgentMarkdown(sourcePath, path.basename(sourcePath, '.agent.md'));
    if (!isSafeAgentProfileId(imported.id)) {
      throw new Error(`Invalid agent profile id: ${imported.id}`);
    }
    const fileName = fileNameForId(imported.id || imported.name);
    const targetPath = path.join(directory, fileName);
    fs.copyFileSync(sourcePath, targetPath);
    return parseAgentMarkdown(targetPath, idFromFileName(fileName));
  }

  routesFromDefinitions(
    currentRoutes: LlmAgentRoute[],
    definitions: AgentManifestDraft[],
  ): LlmAgentRoute[] {
    const routeMap = new Map(currentRoutes.map((route) => [route.agentId, route]));
    const routeAgentIds = new Set<string>(AGENT_ROLES);
    for (const definition of definitions) {
      if (definition.delete || !isSafeAgentProfileId(definition.id)) {
        continue;
      }
      routeAgentIds.add(definition.id);
      const model = definition.models.map(splitCanonicalAgentModelId).find((entry) => entry !== null);
      if (!model) {
        routeMap.set(definition.id, {
          agentId: definition.id,
          providerId: '',
          modelId: '',
        });
        continue;
      }
      // Preserve the explicit canonical route. EffectiveCatalog is the only
      // authority that may accept or reject the model at execution time.
      routeMap.set(definition.id, {
        agentId: definition.id,
        providerId: model.providerId,
        modelId: model.modelId,
      });
    }
    return Array.from(routeAgentIds).map((agentId) => routeMap.get(agentId) ?? {
      agentId,
      providerId: '',
      modelId: '',
    });
  }

  private getModelOptions(providers: LlmProviderEntry[]): AgentModelOption[] {
    return providers.flatMap((provider) => provider.models.map((model) => ({
      canonicalId: canonicalAgentModelId(provider.id, model.id),
      providerId: provider.id,
      providerLabel: provider.label,
      modelId: model.id,
      modelLabel: model.label || model.id,
      configured: provider.enabled && provider.isConfigured && model.enabled !== false,
      status: !provider.enabled || !provider.isConfigured
        ? 'provider-unavailable'
        : model.enabled === false
          ? 'model-disabled'
          : 'ready',
    })));
  }

  private readGlobalInstructions(paths: Pick<AppRuntimePaths, 'instructionsPath'>): string {
    const filePath = this.getGlobalInstructionsPath(paths);
    if (!fs.existsSync(filePath)) {
      return '';
    }
    return fs.readFileSync(filePath, 'utf8');
  }
}

export const agentManifestService = new AgentManifestService();

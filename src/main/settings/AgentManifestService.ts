import fs from 'fs';
import path from 'path';
import { createHash, randomUUID } from 'crypto';
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
import type { EffectiveCatalogSnapshot, EffectiveModel } from '@shared/types/providerCapability';
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

const parseAgentMarkdownContent = (
  rawContent: string,
  filePath: string,
  fallbackId: string,
  updatedAt: string,
): AgentManifestDefinition => {
  const raw = rawContent.replace(/^\uFEFF/u, '');
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
    updatedAt,
  };
};

const parseAgentMarkdown = (filePath: string, fallbackId: string): AgentManifestDefinition => (
  parseAgentMarkdownContent(
    fs.readFileSync(filePath, 'utf8'),
    filePath,
    fallbackId,
    fs.statSync(filePath).mtime.toISOString(),
  )
);

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
    metadata: definition.metadata,
  };
  return `---\n${YAML.stringify(frontmatter).trim()}\n---\n\n${definition.instructions.trim()}\n`;
};

const hashManifestContent = (content: string): string => (
  createHash('sha256').update(content, 'utf8').digest('hex')
);

export interface AgentManifestCommit {
  definition: AgentManifestDefinition | null;
  commitHash: string;
}

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
    catalogs: EffectiveCatalogSnapshot[] = [],
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
      modelOptions: this.getModelOptions(providers, definitions, routes, catalogs),
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

  saveGlobalInstructions(
    paths: Pick<AppRuntimePaths, 'instructionsPath'>,
    globalInstructions: string,
  ): void {
    fs.writeFileSync(this.getGlobalInstructionsPath(paths), globalInstructions.trim(), 'utf8');
  }

  async saveDefinition(
    paths: Pick<AppRuntimePaths, 'agentsPath' | 'instructionsPath'>,
    draft: AgentManifestDraft,
  ): Promise<AgentManifestCommit> {
    const directory = this.getAgentsDirectory(paths);
    await fs.promises.mkdir(directory, { recursive: true });
    const agentId = draft.id || toSlug(draft.name);
    if (!isSafeAgentProfileId(agentId)) {
      throw new Error(`Invalid agent profile id: ${agentId}`);
    }
    const fileName = safeFileNameForDraft(draft);
    const filePath = path.join(directory, fileName);
    if (draft.delete) {
      await fs.promises.rm(filePath, { force: true });
      return {
        definition: null,
        commitHash: hashManifestContent(`deleted:${agentId}`),
      };
    }

    const content = serializeAgentMarkdown({
      ...draft,
      id: agentId,
      fileName,
    });
    const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await fs.promises.writeFile(temporaryPath, content, 'utf8');
      await fs.promises.rename(temporaryPath, filePath);
    } finally {
      await fs.promises.rm(temporaryPath, { force: true });
    }

    const previousFileName = draft.fileName?.endsWith('.agent.md')
      ? path.basename(draft.fileName)
      : fileName;
    const previousPath = path.join(directory, previousFileName);
    if (previousPath !== filePath) {
      await fs.promises.rm(previousPath, { force: true });
    }
    return {
      definition: parseAgentMarkdownContent(content, filePath, agentId, new Date().toISOString()),
      commitHash: hashManifestContent(content),
    };
  }

  async readCommitHash(filePath: string): Promise<string> {
    return hashManifestContent(await fs.promises.readFile(filePath, 'utf8'));
  }

  async readDefinition(
    paths: Pick<AppRuntimePaths, 'agentsPath'>,
    agentId: string,
  ): Promise<AgentManifestDefinition | null> {
    const directory = this.getAgentsDirectory(paths);
    const entries = await fs.promises.readdir(directory).catch(() => [] as string[]);
    const fileName = entries.find((entry) => (
      entry.endsWith('.agent.md') && idFromFileName(entry) === agentId
    ));
    if (!fileName) return null;
    const filePath = path.join(directory, fileName);
    const [content, stat] = await Promise.all([
      fs.promises.readFile(filePath, 'utf8'),
      fs.promises.stat(filePath),
    ]);
    return parseAgentMarkdownContent(content, filePath, agentId, stat.mtime.toISOString());
  }

  routeFromDefinition(definition: Pick<AgentManifestDraft, 'id' | 'models'>): LlmAgentRoute {
    const model = definition.models.map(splitCanonicalAgentModelId).find((entry) => entry !== null);
    return model
      ? { agentId: definition.id, providerId: model.providerId, modelId: model.modelId }
      : { agentId: definition.id, providerId: '', modelId: '' };
  }

  async importFile(
    paths: Pick<AppRuntimePaths, 'agentsPath' | 'instructionsPath'>,
    sourcePath: string,
  ): Promise<AgentManifestDefinition> {
    if (!sourcePath.endsWith('.agent.md')) {
      throw new Error('Only .agent.md files can be imported.');
    }
    const sourceStat = await fs.promises.stat(sourcePath).catch(() => null);
    if (!sourceStat?.isFile()) {
      throw new Error(`Agent manifest not found: ${sourcePath}`);
    }
    const sourceContent = await fs.promises.readFile(sourcePath, 'utf8');
    const imported = parseAgentMarkdownContent(
      sourceContent,
      sourcePath,
      path.basename(sourcePath, '.agent.md'),
      sourceStat.mtime.toISOString(),
    );
    if (!isSafeAgentProfileId(imported.id)) {
      throw new Error(`Invalid agent profile id: ${imported.id}`);
    }
    const { filePath: _filePath, builtin: _builtin, updatedAt: _updatedAt, ...draft } = imported;
    const commit = await this.saveDefinition(paths, {
      ...draft,
      fileName: fileNameForId(imported.id || imported.name),
    });
    if (!commit.definition) throw new Error('Imported agent manifest was not committed.');
    return commit.definition;
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
      // Preserve the explicit canonical route. EffectiveCatalog is the only
      // authority that may accept or reject the model at execution time.
      routeMap.set(definition.id, this.routeFromDefinition(definition));
    }
    return Array.from(routeAgentIds).map((agentId) => routeMap.get(agentId) ?? {
      agentId,
      providerId: '',
      modelId: '',
    });
  }

  projectEffectiveModelOptions(
    settings: AgentManifestSettings,
    providers: LlmProviderEntry[],
    routes: LlmAgentRoute[],
    catalogs: EffectiveCatalogSnapshot[],
  ): AgentManifestSettings {
    return {
      ...settings,
      modelOptions: this.getModelOptions(providers, settings.definitions, routes, catalogs),
    };
  }

  modelOptionCatalogProviderIds(
    providers: LlmProviderEntry[],
    routes: LlmAgentRoute[],
  ): string[] {
    return [...new Set([
      ...routes
        .map((route) => route.providerId)
        .filter((providerId): providerId is string => Boolean(providerId)),
      ...providers
        .filter((provider) => (
          provider.catalogOwnership !== 'user-managed'
          && provider.enabled
          && provider.isConfigured
        ))
        .map((provider) => provider.id),
    ])];
  }

  private getModelOptions(
    providers: LlmProviderEntry[],
    definitions: Array<Pick<AgentManifestDefinition, 'models'>>,
    routes: LlmAgentRoute[],
    catalogs: EffectiveCatalogSnapshot[],
  ): AgentModelOption[] {
    const referenced = new Set([
      ...definitions.flatMap((definition) => definition.models),
      ...routes.map((route) => canonicalAgentModelId(route.providerId, route.modelId)).filter(Boolean),
    ]);
    const options: AgentModelOption[] = [];
    const seen = new Set<string>();
    const internalTargets = new Set(catalogs.flatMap((catalog) => catalog.models
      .filter((model) => model.selection?.pickerVisibility === 'internal')
      .map((model) => canonicalAgentModelId(catalog.providerId, model.modelId))));
    const addOption = (option: AgentModelOption): void => {
      if (!option.canonicalId || seen.has(option.canonicalId)) return;
      seen.add(option.canonicalId);
      options.push(option);
    };
    const providerUnavailableReason = (provider: LlmProviderEntry): string | undefined => (
      provider.unavailableReason
      ?? (!provider.enabled ? 'Provider is disabled.' : !provider.isConfigured ? 'Provider is not connected.' : undefined)
    );
    const fromEffectiveModel = (provider: LlmProviderEntry, model: EffectiveModel): AgentModelOption => {
      const canonicalId = canonicalAgentModelId(provider.id, model.modelId);
      const providerUnavailable = !provider.enabled || !provider.isConfigured;
      const modelDisabled = model.enabled === false;
      const missingVerifiedBudget = !Number.isFinite(model.defaultBudgetTokens) || model.defaultBudgetTokens <= 0;
      const status: AgentModelOption['status'] = providerUnavailable
        ? 'provider-unavailable'
        : modelDisabled
          ? 'model-disabled'
          : model.availability === 'available' && !missingVerifiedBudget
            ? 'ready'
            : model.availability === 'unavailable'
              ? 'model-unavailable'
              : 'model-unverified';
      const disabledReason = status === 'provider-unavailable'
        ? providerUnavailableReason(provider)
        : status === 'model-disabled'
          ? 'Model is disabled.'
          : status === 'model-unavailable'
            ? model.unavailableReason ?? 'Model is unavailable for this account and route.'
            : status === 'model-unverified'
              ? missingVerifiedBudget
                ? 'Model has no verified positive context budget and cannot be executed safely.'
                : 'Model availability has not been verified for this account and route.'
              : undefined;
      return {
        canonicalId,
        providerId: provider.id,
        providerLabel: provider.label || provider.id,
        modelId: model.modelId,
        modelLabel: model.label || model.modelId,
        configured: status === 'ready',
        status,
        ...(disabledReason ? { disabledReason } : {}),
      };
    };

    for (const provider of providers) {
      if (provider.catalogOwnership !== 'user-managed') {
        const snapshot = catalogs.find((catalog) => (
          catalog.providerId === provider.id
          && catalog.accountId === (provider.activeAccountId ?? `anonymous:${provider.id}`)
          && catalog.protocol === provider.protocol
        ));
        for (const model of snapshot?.models ?? []) {
          if (model.selection?.pickerVisibility === 'internal') continue;
          const canonicalId = canonicalAgentModelId(provider.id, model.modelId);
          const executable = model.availability === 'available'
            && Number.isFinite(model.defaultBudgetTokens)
            && model.defaultBudgetTokens > 0;
          if (executable || referenced.has(canonicalId)) {
            addOption(fromEffectiveModel(provider, model));
          }
        }
        continue;
      }
      for (const model of provider.models) {
        const canonicalId = canonicalAgentModelId(provider.id, model.id);
        const providerUnavailable = !provider.enabled || !provider.isConfigured;
        const disabled = model.enabled === false;
        const status: AgentModelOption['status'] = providerUnavailable
          ? 'provider-unavailable'
          : disabled ? 'model-disabled' : 'ready';
        addOption({
          canonicalId,
          providerId: provider.id,
          providerLabel: provider.label || provider.id,
          modelId: model.id,
          modelLabel: model.label || model.id,
          configured: status === 'ready',
          status,
          ...(status === 'provider-unavailable'
            ? { disabledReason: providerUnavailableReason(provider) }
            : status === 'model-disabled' ? { disabledReason: 'Model is disabled.' } : {}),
        });
      }
    }

    for (const canonicalId of referenced) {
      if (seen.has(canonicalId) || internalTargets.has(canonicalId)) continue;
      const parsed = splitCanonicalAgentModelId(canonicalId);
      if (!parsed) continue;
      const provider = providers.find((entry) => entry.id === parsed.providerId);
      addOption({
        canonicalId,
        providerId: parsed.providerId,
        providerLabel: provider?.label || parsed.providerId,
        modelId: parsed.modelId,
        modelLabel: parsed.modelId,
        configured: false,
        status: 'missing',
        disabledReason: 'This model is not present in the current account catalog.',
      });
    }

    return options.sort((left, right) => (
      left.providerLabel.localeCompare(right.providerLabel)
      || Number(right.configured) - Number(left.configured)
      || left.modelLabel.localeCompare(right.modelLabel)
    ));
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

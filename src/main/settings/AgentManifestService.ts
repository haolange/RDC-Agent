import fs from 'fs';
import path from 'path';
import { createHash, randomUUID } from 'crypto';
import { isSafeAgentProfileId } from '@shared/types/agent';
import type {
  AgentManifestDefinition,
  AgentManifestDraft,
  AgentManifestSettings,
  AgentManifestWriteScope,
  AgentModelOption,
} from '@shared/types/agentManifest';
import type { AppRuntimePaths, LlmAgentRoute, LlmProviderEntry } from '@shared/types/settings';
import type { EffectiveCatalogSnapshot, EffectiveModel } from '@shared/types/providerCapability';
import type { EffectiveAgentProfile, ScopedResourceCandidate } from '@shared/types/rdxRuntime';
import { AGENT_ROLES } from '@shared/constants/agents';
import { canonicalAgentModelId, splitCanonicalAgentModelId } from '@shared/utils/agentModelRoute';
import { classifyAgentToolEligibility, isAgentToolExecutableModel } from '@shared/utils/agentToolCapability';
import { appPathService } from '../runtime/AppPathService';
import { scopedResourceResolver } from '../runtime/ScopedResourceResolver';
import { parseAgentMarkdownStrict, serializeAgentMarkdown } from './agentManifestParse';
import { agentSeedMigrationService } from './seed-migration/AgentSeedMigrationService';
import { isHistoricalReservedAgentId } from './seed-migration/officialSeedGenerations';
import {
  extractSeedSemanticManifest,
  hashSeedSemanticManifest,
  readSeedFrontmatterId,
} from './seed-migration/semanticHash';

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
  const expected = fileNameForId(agentId);
  if (draft.fileName) {
    const candidate = path.basename(draft.fileName);
    if (idFromFileName(candidate) !== agentId) {
      throw new Error(`AGENT_MANIFEST_FILENAME_MISMATCH: file stem must equal id ${agentId}.`);
    }
  }
  return expected;
};

const hashManifestContent = (content: string): string => (
  createHash('sha256').update(content, 'utf8').digest('hex')
);

const hashManifestFile = (filePath: string, id: string): string =>
  hashSeedSemanticManifest(extractSeedSemanticManifest(fs.readFileSync(filePath, 'utf8'), id));

const reservedHistoricalIdsForCandidate = (
  candidate: ScopedResourceCandidate<AgentManifestDefinition>,
): string[] => {
  const filenameId = idFromFileName(path.basename(candidate.sourcePath));
  const ids = [filenameId, candidate.id];
  try {
    const frontmatterId = readSeedFrontmatterId(fs.readFileSync(candidate.sourcePath, 'utf8'));
    if (frontmatterId) ids.push(frontmatterId);
  } catch {
    // filename / parsed id are enough
  }
  return [...new Set(ids.filter((id) => isHistoricalReservedAgentId(id)))];
};

export interface AgentManifestCommit {
  definition: AgentManifestDefinition | null;
  commitHash: string;
}

export interface AgentManifestSaveOptions {
  scope: AgentManifestWriteScope;
  projectRoot?: string;
  sourceHash?: string;
}

interface ParsedManifestCandidate {
  candidate: ScopedResourceCandidate<AgentManifestDefinition>;
  builtinInvalid?: string;
}

const listAgentManifestFiles = (directory: string): string[] => {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory).filter((entry) => (
    entry.endsWith('.agent.md')
    && !entry.startsWith('.')
    && isSafeAgentProfileId(idFromFileName(entry))
  ));
};

const loadManifestCandidates = (
  directory: string,
  scope: ScopedResourceCandidate<AgentManifestDefinition>['scope'],
  failClosedOnInvalid: boolean,
): ParsedManifestCandidate[] => {
  const results: ParsedManifestCandidate[] = [];
  for (const entry of listAgentManifestFiles(directory)) {
    const filePath = path.join(directory, entry);
    const fallbackId = idFromFileName(entry);
    const parsed = parseAgentMarkdownStrict(
      fs.readFileSync(filePath, 'utf8'),
      filePath,
      fallbackId,
      fs.statSync(filePath).mtime.toISOString(),
      scope === 'builtin',
    );
    if (!parsed.ok) {
      if (failClosedOnInvalid) {
        throw new Error(`BUILTIN_AGENT_MANIFEST_INVALID: ${filePath}: ${parsed.reason}`);
      }
      results.push({
        candidate: {
          id: fallbackId,
          kind: 'agent',
          scope,
          sourcePath: filePath,
          value: {
            id: fallbackId,
            fileName: entry,
            filePath,
            name: fallbackId,
            description: '',
            argumentHint: '',
            target: 'rdc-agent',
            models: [],
            icon: 'message-orbit',
            accent: '#33d1ff',
            disableModelInvocation: false,
            userInvocable: false,
            tools: [],
            skills: [],
            mcpServers: [],
            agents: [],
            handoffs: [],
            metadata: {},
            instructions: '',
            builtin: scope === 'builtin',
            enabled: false,
          },
          enabled: false,
          invalid: true,
          invalidReason: parsed.reason,
        },
      });
      continue;
    }
    results.push({
      candidate: {
        id: parsed.definition.id,
        kind: 'agent',
        scope,
        sourcePath: filePath,
        value: {
          ...parsed.definition,
          builtin: scope === 'builtin',
        },
        enabled: parsed.definition.enabled,
      },
    });
  }
  return results;
};

export class AgentManifestService {
  private getAgentsDirectory(paths: Pick<AppRuntimePaths, 'agentsPath'>): string {
    return paths.agentsPath;
  }

  private getGlobalInstructionsPath(paths: Pick<AppRuntimePaths, 'instructionsPath'>): string {
    return paths.instructionsPath;
  }

  resolveEffectiveSnapshot(
    paths: Pick<AppRuntimePaths, 'agentsPath' | 'instructionsPath'>,
    projectRoot?: string,
  ): { profiles: EffectiveAgentProfile[]; diagnostics: string[] } {
    const migration = agentSeedMigrationService.migrateUserAgents(this.getAgentsDirectory(paths));
    const candidates: Array<ScopedResourceCandidate<AgentManifestDefinition>> = [];
    const diagnostics: string[] = [...migration.diagnostics];

    const builtinPath = appPathService.getBuiltinAgentsPath();
    if (!fs.existsSync(builtinPath)) {
      throw new Error(`BUILTIN_AGENT_MANIFESTS_MISSING: ${builtinPath}`);
    }
    for (const loaded of loadManifestCandidates(builtinPath, 'builtin', true)) {
      candidates.push(loaded.candidate);
    }

    for (const loaded of loadManifestCandidates(this.getAgentsDirectory(paths), 'user', false)) {
      const reserved = reservedHistoricalIdsForCandidate(loaded.candidate);
      if (reserved.length > 0) {
        diagnostics.push(
          `AGENT_ID_RESERVED_HISTORICAL: user agent '${reserved[0]}' is a reserved historical id (${loaded.candidate.sourcePath})`,
        );
        continue;
      }
      if (loaded.candidate.invalid) {
        diagnostics.push(`USER_AGENT_MANIFEST_INVALID: ${loaded.candidate.sourcePath}: ${loaded.candidate.invalidReason}`);
      }
      candidates.push(loaded.candidate);
    }

    if (projectRoot) {
      const projectAgentsPath = appPathService.getProjectRdxPaths(projectRoot).agentsPath;
      for (const loaded of loadManifestCandidates(projectAgentsPath, 'project', false)) {
        const reserved = reservedHistoricalIdsForCandidate(loaded.candidate);
        if (reserved.length > 0) {
          diagnostics.push(
            `AGENT_ID_RESERVED_HISTORICAL: project agent '${reserved[0]}' is a reserved historical id (${loaded.candidate.sourcePath})`,
          );
          continue;
        }
        if (loaded.candidate.invalid) {
          diagnostics.push(`PROJECT_AGENT_MANIFEST_INVALID: ${loaded.candidate.sourcePath}: ${loaded.candidate.invalidReason}`);
        }
        candidates.push(loaded.candidate);
      }
    }

    const resolved = scopedResourceResolver.resolve(candidates);
    diagnostics.push(...resolved.diagnostics.map((entry) => `${entry.code}: ${entry.message}`));
    const profiles = resolved.resources.map((resource) => ({
      ...resource.value,
      builtin: resource.provenance.scope === 'builtin',
      effectiveStatus: resource.effectiveStatus,
      provenance: {
        ...resource.provenance,
        sourceHash: hashManifestFile(resource.provenance.sourcePath, resource.id),
      },
      compiledRoute: this.routeFromDefinition(resource.value),
    }));
    return { profiles, diagnostics };
  }

  getSettings(
    paths: Pick<AppRuntimePaths, 'agentsPath' | 'instructionsPath'>,
    providers: LlmProviderEntry[],
    routes: LlmAgentRoute[],
    catalogs: EffectiveCatalogSnapshot[] = [],
    projectRoot?: string,
  ): AgentManifestSettings {
    const { profiles, diagnostics } = this.resolveEffectiveSnapshot(paths, projectRoot);
    const definitions = profiles
      .slice()
      .sort((left, right) => Number(right.userInvocable) - Number(left.userInvocable) || left.name.localeCompare(right.name));
    return {
      directoryPath: this.getAgentsDirectory(paths),
      definitions,
      modelOptions: this.getModelOptions(providers, definitions, routes, catalogs),
      globalInstructions: this.readGlobalInstructions(paths),
      diagnostics,
    };
  }

  getEffectiveProfiles(
    paths: Pick<AppRuntimePaths, 'agentsPath' | 'instructionsPath'>,
    _providers: LlmProviderEntry[],
    _routes: LlmAgentRoute[],
    projectRoot?: string,
  ): EffectiveAgentProfile[] {
    return this.resolveEffectiveSnapshot(paths, projectRoot).profiles;
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
    options: AgentManifestSaveOptions = { scope: 'user' },
  ): Promise<AgentManifestCommit> {
    if (options.scope !== 'user' && options.scope !== 'project') {
      throw new Error('AGENT_MANIFEST_SCOPE_REQUIRED: save/delete must specify user or project.');
    }
    const agentId = draft.id || toSlug(draft.name);
    if (!isSafeAgentProfileId(agentId)) {
      throw new Error(`Invalid agent profile id: ${agentId}`);
    }
    const directory = options.scope === 'project'
      ? this.resolveProjectAgentsPath(options.projectRoot)
      : this.getAgentsDirectory(paths);
    if (options.scope === 'user' && path.resolve(directory) === path.resolve(appPathService.getBuiltinAgentsPath())) {
      throw new Error('BUILTIN_AGENT_MANIFEST_READONLY: edit requires an explicit user copy-on-write.');
    }
    await fs.promises.mkdir(directory, { recursive: true });
    const fileName = safeFileNameForDraft(draft);
    const filePath = path.join(directory, fileName);
    const current = this.resolveEffectiveSnapshot(
      paths,
      options.scope === 'project' ? options.projectRoot : undefined,
    ).profiles.find((profile) => profile.id === agentId);
    if (options.sourceHash && current && current.provenance.sourceHash !== options.sourceHash) {
      throw new Error('AGENT_MANIFEST_SOURCE_HASH_CONFLICT: the effective profile changed since the editor loaded.');
    }
    if (current?.provenance.scope === 'builtin' && options.scope === 'project' && !draft.delete) {
      // copy-on-write to project is allowed
    }
    const resolutionRoot = options.scope === 'project' ? options.projectRoot : undefined;
    if (draft.delete) {
      if (current?.provenance.scope === 'builtin' && options.scope === 'user') {
        throw new Error('BUILTIN_AGENT_MANIFEST_READONLY: deleting a builtin profile is not allowed.');
      }
      await fs.promises.rm(filePath, { force: true });
      return {
        definition: this.resolveEffectiveDefinition(paths, agentId, resolutionRoot),
        commitHash: hashManifestContent(`deleted:${agentId}`),
      };
    }

    const parsed = parseAgentMarkdownStrict(
      serializeAgentMarkdown({ ...draft, id: agentId, fileName }),
      filePath,
      agentId,
      new Date().toISOString(),
      false,
    );
    if (!parsed.ok) {
      throw new Error(`AGENT_MANIFEST_INVALID: ${parsed.reason}`);
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

    const ownedFileName = fileNameForId(agentId);
    if (path.basename(filePath) !== ownedFileName) {
      throw new Error(`AGENT_MANIFEST_FILENAME_MISMATCH: write path must be ${ownedFileName}.`);
    }
    return {
      definition: this.resolveEffectiveDefinition(paths, agentId, resolutionRoot),
      commitHash: hashManifestContent(content),
    };
  }

  private resolveEffectiveDefinition(
    paths: Pick<AppRuntimePaths, 'agentsPath' | 'instructionsPath'>,
    agentId: string,
    projectRoot?: string,
  ): AgentManifestDefinition | null {
    return this.resolveEffectiveSnapshot(paths, projectRoot).profiles.find((profile) => profile.id === agentId) ?? null;
  }

  private resolveProjectAgentsPath(projectRoot?: string): string {
    if (!projectRoot?.trim()) {
      throw new Error('AGENT_MANIFEST_PROJECT_ROOT_REQUIRED: project-scoped save needs a project root.');
    }
    return appPathService.getProjectRdxPaths(projectRoot).agentsPath;
  }

  async readCommitHash(filePath: string): Promise<string> {
    return hashManifestContent(await fs.promises.readFile(filePath, 'utf8'));
  }

  async readDefinition(
    paths: Pick<AppRuntimePaths, 'agentsPath'>,
    agentId: string,
    options?: { scope?: 'user' | 'project'; projectRoot?: string },
  ): Promise<AgentManifestDefinition | null> {
    const directory = options?.scope === 'project'
      ? this.resolveProjectAgentsPath(options.projectRoot)
      : this.getAgentsDirectory(paths);
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
    const parsed = parseAgentMarkdownStrict(content, filePath, agentId, stat.mtime.toISOString(), false);
    return parsed.ok ? parsed.definition : null;
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
    const imported = parseAgentMarkdownStrict(
      sourceContent,
      sourcePath,
      path.basename(sourcePath, '.agent.md'),
      sourceStat.mtime.toISOString(),
      false,
    );
    if (!imported.ok) {
      throw new Error(`Imported agent manifest is invalid: ${imported.reason}`);
    }
    if (!isSafeAgentProfileId(imported.definition.id)) {
      throw new Error(`Invalid agent profile id: ${imported.definition.id}`);
    }
    const { filePath: _filePath, builtin: _builtin, updatedAt: _updatedAt, ...draft } = imported.definition;
    const commit = await this.saveDefinition(paths, {
      ...draft,
      fileName: fileNameForId(imported.definition.id || imported.definition.name),
    }, { scope: 'user' });
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
      const eligibility = classifyAgentToolEligibility(model);
      const toolExecutable = eligibility === 'executable' && !missingVerifiedBudget;
      const status: AgentModelOption['status'] = providerUnavailable
        ? 'provider-unavailable'
        : modelDisabled
          ? 'model-disabled'
          : model.availability === 'unavailable' || eligibility === 'unsupported' || eligibility === 'no-adapter'
            ? 'model-unavailable'
            : model.availability === 'available' && toolExecutable
              ? 'ready'
              : 'model-unverified';
      const disabledReason = status === 'provider-unavailable'
        ? providerUnavailableReason(provider)
        : status === 'model-disabled'
          ? 'Model is disabled.'
          : status === 'model-unavailable'
            ? eligibility === 'unsupported'
              ? 'This provider route explicitly does not support native structured agent tools.'
              : eligibility === 'no-adapter'
                ? 'This provider route has no implemented native structured-tool adapter.'
                : model.unavailableReason ?? 'Model is unavailable for this account and route.'
            : status === 'model-unverified'
              ? missingVerifiedBudget
                ? 'Model has no verified positive context budget and cannot be executed safely.'
                : eligibility === 'unknown'
                  ? 'Native tool calling is not confirmed for this provider route, so the model is not an Agent-executable choice.'
                  : 'Model availability has not been verified for this account and route.'
              : undefined;
      // models.json user overrides are the only layer that carries sourceKind 'user'.
      const isUserOverride = model.provenance.some((evidence) => (
        evidence.source === 'user' && evidence.sourceKind === 'user'
      ));
      return {
        canonicalId,
        providerId: provider.id,
        providerLabel: provider.label || provider.id,
        modelId: model.modelId,
        modelLabel: model.label || model.modelId,
        configured: status === 'ready',
        status,
        ...(disabledReason ? { disabledReason } : {}),
        ...(model.cost ? { cost: model.cost } : {}),
        ...(isUserOverride ? { custom: true } : {}),
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
          const executable = isAgentToolExecutableModel(model)
            && Number.isFinite(model.defaultBudgetTokens)
            && model.defaultBudgetTokens > 0;
          if (executable || referenced.has(canonicalId)) {
            addOption(fromEffectiveModel(provider, model));
          }
        }
        continue;
      }
      const snapshot = catalogs.find((catalog) => (
        catalog.providerId === provider.id
        && catalog.accountId === (provider.activeAccountId ?? `anonymous:${provider.id}`)
      ));
      for (const model of provider.models) {
        const canonicalId = canonicalAgentModelId(provider.id, model.id);
        const effective = snapshot?.models.find((entry) => (
          entry.modelId === model.id || entry.aliases.includes(model.id)
        ));
        if (effective) {
          const executable = isAgentToolExecutableModel(effective)
            && Number.isFinite(effective.defaultBudgetTokens)
            && effective.defaultBudgetTokens > 0;
          if (executable || referenced.has(canonicalId)) {
            addOption(fromEffectiveModel(provider, effective));
          }
          continue;
        }
        if (!referenced.has(canonicalId)) continue;
        const providerUnavailable = !provider.enabled || !provider.isConfigured;
        const disabled = model.enabled === false;
        const status: AgentModelOption['status'] = providerUnavailable
          ? 'provider-unavailable'
          : disabled ? 'model-disabled' : 'model-unverified';
        addOption({
          canonicalId,
          providerId: provider.id,
          providerLabel: provider.label || provider.id,
          modelId: model.id,
          modelLabel: model.label || model.id,
          configured: false,
          status,
          ...(status === 'provider-unavailable'
            ? { disabledReason: providerUnavailableReason(provider) }
            : status === 'model-disabled'
              ? { disabledReason: 'Model is disabled.' }
              : { disabledReason: 'Native tool calling is not confirmed for this provider route, so the model is not an Agent-executable choice.' }),
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

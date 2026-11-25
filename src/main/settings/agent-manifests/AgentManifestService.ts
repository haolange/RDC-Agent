import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { isProviderExecutable } from '@shared/utils/providerExecutionAvailability';
import { GENERAL_AGENT_ID, isSafeAgentProfileId } from '@shared/types/agent';
import {
  AGENT_PROJECT_CEILING_NARROWED,
  AGENT_PROJECT_UNTRUSTED,
  agentAccessCeiling,
  narrowerAccessCeiling,
  type AgentAccessCeiling,
} from '@shared/types/agentManifest';
import { AGENT_ROLES } from '@shared/constants/agents';
import { canonicalAgentModelId, resolveAgentModel, splitCanonicalAgentModelId } from '@shared/utils/agentModelRoute';
import { classifyAgentToolEligibility, isAgentToolExecutableModel } from '@shared/utils/agentToolCapability';
import { getReasoningSelectionOrder } from '@shared/types/modelCapability';
import { AppError } from '@shared/errors/appError';
import { deepFreeze } from '@shared/utils/deepFreeze';
import { appPathService } from '../../runtime/AppPathService';
import { scopedResourceResolver } from '../../runtime/ScopedResourceResolver';
import { resolvedPathKey, samePath } from '../../platform/paths';
import { isReservedAgentId } from '../settings-core/reservedAgentIds';
import { StampedValue, directoryStamp, fileStamp } from '../settings-core/externalInput';
import { writeFileAtomic } from '../../runtime/atomicFile';
import { AGENT_MANIFEST_FIELD_MOVED, parseAgentMarkdownStrict, readAgentFrontmatterId, serializeAgentMarkdown } from './agentManifestParse';
import { projectAgentTrust } from './ProjectAgentTrust';
import type { EffectiveAgentProfile, ScopedResourceCandidate } from '@shared/types/rdcRuntime';
import type { EffectiveCatalogSnapshot, EffectiveModel } from '@shared/types/providerCapability';
import type { AgentModelSettings, AppRuntimePaths, LlmAgentRoute, LlmProviderEntry } from '@shared/types/settings';
import type {
  AgentManifestDefinition,
  AgentManifestDiagnostic,
  AgentManifestDraft,
  AgentManifestSettings,
  AgentManifestWriteScope,
  AgentModelOption,
  AgentBuiltinComparison,
} from '@shared/types/agentManifest';

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
      throw new AppError('AGENT_MANIFEST_FILENAME_MISMATCH', `file stem must equal id ${agentId}.`);
    }
  }
  return expected;
};

const hashManifestContent = (content: string): string => (
  createHash('sha256').update(content, 'utf8').digest('hex')
);

const hashManifestFile = (filePath: string): string =>
  hashManifestContent(fs.readFileSync(filePath, 'utf8'));

const reservedAgentIdsForCandidate = (
  candidate: ScopedResourceCandidate<AgentManifestDefinition>,
): string[] => {
  const filenameId = idFromFileName(path.basename(candidate.sourcePath));
  const ids = [filenameId, candidate.id];
  try {
    const frontmatterId = readAgentFrontmatterId(fs.readFileSync(candidate.sourcePath, 'utf8'));
    if (frontmatterId) ids.push(frontmatterId);
  } catch {
    // filename / parsed id are enough
  }
  return [...new Set(ids.filter((id) => isReservedAgentId(id)))];
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

const isAgentManifestFileName = (entry: string): boolean => entry.endsWith('.agent.md') && !entry.startsWith('.');

const listAgentManifestFiles = (directory: string): string[] => {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory).filter((entry) => (
    isAgentManifestFileName(entry) && isSafeAgentProfileId(idFromFileName(entry))
  ));
};

/** A project profile without a user or builtin profile of the same id never gets process execution. */
const PROJECT_AGENT_ACCESS_CEILING: AgentAccessCeiling = 'workspace-write';

/**
 * A project profile may narrow what the profile it overrides can do, never widen it; a new project
 * profile is held to workspace writes.
 */
const clampProjectAccessCeiling = (
  candidate: ScopedResourceCandidate<AgentManifestDefinition>,
  lowerScopes: ReadonlyArray<ScopedResourceCandidate<AgentManifestDefinition>>,
): { candidate: ScopedResourceCandidate<AgentManifestDefinition>; narrowedFrom?: AgentAccessCeiling } => {
  if (candidate.invalid) return { candidate };
  const overridden = lowerScopes.filter((entry) => entry.id === candidate.id && !entry.invalid).at(-1);
  const limit = overridden ? agentAccessCeiling(overridden.value) : PROJECT_AGENT_ACCESS_CEILING;
  const declared = agentAccessCeiling(candidate.value);
  const effective = narrowerAccessCeiling(declared, limit);
  if (effective === declared) return { candidate };
  return {
    candidate: { ...candidate, value: { ...candidate.value, accessCeiling: effective } },
    ...(candidate.value.accessCeiling ? { narrowedFrom: declared } : {}),
  };
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
        throw new AppError('BUILTIN_AGENT_MANIFEST_INVALID', `${filePath}: ${parsed.reason}`);
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

interface ManifestFiles {
  resolved: ReturnType<typeof scopedResourceResolver.resolve<AgentManifestDefinition>>;
  diagnostics: AgentManifestDiagnostic[];
  builtinHashes: Map<string, string>;
  sourceHashes: Map<string, string>;
  trustRevision: number;
}

interface EffectiveSnapshot {
  profiles: EffectiveAgentProfile[];
  diagnostics: AgentManifestDiagnostic[];
}

/**
 * Agent manifests (builtin, user and project files, with project trust) are read once per project and kept until a
 * write through this service, a trust decision, or a changed file stamp at `revalidate` (turn preparation and
 * Settings open). The Agent model choice comes from Settings and is applied on top without reading files.
 */
export class AgentManifestService {
  private readAgentModels: () => AgentModelSettings = () => ({ default: {}, byAgent: {} });
  private readonly manifestFiles = new Map<string, StampedValue<ManifestFiles>>();
  private readonly effective = new WeakMap<ManifestFiles, { agentModels: AgentModelSettings; snapshot: EffectiveSnapshot }>();
  private readonly globalInstructions = new Map<string, StampedValue<string>>();
  private readonly sortedDefinitions = new WeakMap<EffectiveSnapshot, readonly AgentManifestDefinition[]>();

  /** Settings owns which model each Agent uses; manifests never carry it. */
  bindAgentModelSettings(read: () => AgentModelSettings): void {
    this.readAgentModels = read;
  }

  /** Re-checks every cached manifest input against the files; true when anything changed outside the app. */
  revalidate(): boolean {
    let changed = false;
    for (const value of [...this.manifestFiles.values(), ...this.globalInstructions.values()]) {
      changed = value.revalidate() || changed;
    }
    return changed;
  }

  /** Drops every cached manifest input after the app changed manifest files itself. */
  invalidate(): void {
    for (const value of [...this.manifestFiles.values(), ...this.globalInstructions.values()]) value.invalidate();
  }

  private loadManifestFiles(
    paths: Pick<AppRuntimePaths, 'agentsPath' | 'instructionsPath'>,
    projectRoot?: string,
  ): ManifestFiles {
    const key = JSON.stringify([paths.agentsPath, projectRoot ?? '']);
    let value = this.manifestFiles.get(key);
    if (!value) {
      const directories = [
        appPathService.getBuiltinAgentsPath(),
        this.getAgentsDirectory(paths),
        ...(projectRoot ? [appPathService.getProjectRdcPaths(projectRoot).agentsPath] : []),
      ];
      value = new StampedValue(
        () => [...directories.map((directory) => directoryStamp(directory, isAgentManifestFileName)), projectAgentTrust.stamp()].join('#'),
        () => this.readManifestFiles(paths, projectRoot),
      );
      this.manifestFiles.set(key, value);
    }
    const files = value.get();
    if (files.trustRevision === projectAgentTrust.revision) return files;
    value.invalidate();
    return value.get();
  }

  private getAgentsDirectory(paths: Pick<AppRuntimePaths, 'agentsPath'>): string {
    return paths.agentsPath;
  }

  private getGlobalInstructionsPath(paths: Pick<AppRuntimePaths, 'instructionsPath'>): string {
    return paths.instructionsPath;
  }

  resolveEffectiveSnapshot(
    paths: Pick<AppRuntimePaths, 'agentsPath' | 'instructionsPath'>,
    projectRoot?: string,
  ): EffectiveSnapshot {
    const files = this.loadManifestFiles(paths, projectRoot);
    const agentModels = this.readAgentModels();
    const cached = this.effective.get(files);
    if (cached?.agentModels === agentModels) return cached.snapshot;
    const profiles = files.resolved.resources.map((resource) => {
      const model = resolveAgentModel(resource.value.id, agentModels);
      const builtinSourceHash = resource.provenance.scope === 'builtin' ? undefined : files.builtinHashes.get(resource.value.id);
      return {
        ...resource.value,
        builtin: resource.provenance.scope === 'builtin',
        effectiveStatus: resource.effectiveStatus,
        provenance: {
          ...resource.provenance,
          sourceHash: files.sourceHashes.get(resource.provenance.sourcePath)!,
        },
        compiledRoute: { agentId: resource.value.id, providerId: model.route?.providerId ?? '', modelId: model.route?.modelId ?? '' },
        ...(model.reasoningLevel ? { reasoningLevel: model.reasoningLevel } : {}),
        modelSource: model.source,
        ...(builtinSourceHash ? { builtinUpdate: {
          builtinSourceHash,
          status: !resource.value.basedOn ? 'unknown-base' as const : resource.value.basedOn === builtinSourceHash ? 'current' as const : 'updated' as const,
        } } : {}),
      };
    });
    const snapshot = deepFreeze({ profiles, diagnostics: files.diagnostics });
    this.effective.set(files, { agentModels, snapshot });
    return snapshot;
  }

  private readManifestFiles(
    paths: Pick<AppRuntimePaths, 'agentsPath' | 'instructionsPath'>,
    projectRoot?: string,
  ): ManifestFiles {
    const trustRevision = projectAgentTrust.revision;
    const candidates: Array<ScopedResourceCandidate<AgentManifestDefinition>> = [];
    const diagnostics: AgentManifestDiagnostic[] = [];

    const builtinPath = appPathService.getBuiltinAgentsPath();
    if (!fs.existsSync(builtinPath)) {
      throw new AppError('BUILTIN_AGENT_MANIFESTS_MISSING', builtinPath);
    }
    for (const loaded of loadManifestCandidates(builtinPath, 'builtin', true)) {
      candidates.push(loaded.candidate);
    }

    for (const loaded of loadManifestCandidates(this.getAgentsDirectory(paths), 'user', false)) {
      const reserved = reservedAgentIdsForCandidate(loaded.candidate);
      if (reserved.length > 0) {
        diagnostics.push(
          { code: 'AGENT_ID_RESERVED_HISTORICAL', severity: 'error', scope: 'user', agentId: reserved[0], sourcePath: loaded.candidate.sourcePath, message: `Agent id '${reserved[0]}' is reserved.` },
        );
        continue;
      }
      candidates.push(loaded.candidate);
    }

    if (projectRoot) {
      const projectAgentsPath = appPathService.getProjectRdcPaths(projectRoot).agentsPath;
      for (const loaded of loadManifestCandidates(projectAgentsPath, 'project', false)) {
        const reserved = reservedAgentIdsForCandidate(loaded.candidate);
        if (reserved.length > 0) {
          diagnostics.push(
            { code: 'AGENT_ID_RESERVED_HISTORICAL', severity: 'error', scope: 'project', agentId: reserved[0], sourcePath: loaded.candidate.sourcePath, message: `Agent id '${reserved[0]}' is reserved.` },
          );
          continue;
        }
        if (!loaded.candidate.invalid && !projectAgentTrust.isTrusted(projectRoot, loaded.candidate.id, loaded.candidate.sourcePath)) {
          diagnostics.push({
            code: AGENT_PROJECT_UNTRUSTED, severity: 'warning', scope: 'project', agentId: loaded.candidate.id,
            sourcePath: loaded.candidate.sourcePath, message: 'This project brings its own Agent profile; it loads only after you trust it.',
          });
          continue;
        }
        const clamped = clampProjectAccessCeiling(loaded.candidate, candidates);
        if (clamped.narrowedFrom) {
          diagnostics.push({
            code: AGENT_PROJECT_CEILING_NARROWED, severity: 'warning', scope: 'project', agentId: loaded.candidate.id,
            sourcePath: loaded.candidate.sourcePath,
            message: `Access ceiling ${clamped.narrowedFrom} narrowed to ${agentAccessCeiling(clamped.candidate.value)}: a project profile cannot exceed the profile it overrides.`,
          });
        }
        candidates.push(clamped.candidate);
      }
    }

    const resolved = scopedResourceResolver.resolve(candidates);
    for (const entry of resolved.diagnostics) {
      const candidate = candidates.find(value => value.sourcePath === entry.sourcePath);
      if (!candidate) throw new AppError('AGENT_DIAGNOSTIC_SOURCE_MISSING');
      const movedPrefix = `${AGENT_MANIFEST_FIELD_MOVED}: `;
      const moved = entry.code === 'resource.invalid' && entry.message.startsWith(movedPrefix);
      diagnostics.push({
        ...entry,
        ...(moved ? { code: AGENT_MANIFEST_FIELD_MOVED, message: entry.message.slice(movedPrefix.length) } : {}),
        scope: candidate.scope,
        agentId: candidate.id,
        sourcePath: candidate.sourcePath,
      });
    }
    const uniqueDiagnostics = [...new Map(diagnostics.map(issue => {
      return [JSON.stringify([resolvedPathKey(issue.sourcePath), issue.code, issue.message]), issue] as const;
    })).values()].sort((a, b) => a.scope.localeCompare(b.scope) || a.sourcePath.localeCompare(b.sourcePath) || a.code.localeCompare(b.code));
    const builtinHashes = new Map(candidates.filter((candidate) => candidate.scope === 'builtin')
      .map((candidate) => [candidate.id, hashManifestFile(candidate.sourcePath)] as const));
    const sourceHashes = new Map(resolved.resources.map((resource) => (
      [resource.provenance.sourcePath, hashManifestFile(resource.provenance.sourcePath)] as const
    )));
    return { resolved, diagnostics: uniqueDiagnostics, builtinHashes, sourceHashes, trustRevision };
  }

  /** Effective profiles in the order Settings lists them: user-invocable first, then by name. */
  definitions(
    paths: Pick<AppRuntimePaths, 'agentsPath' | 'instructionsPath'>,
    projectRoot?: string,
  ): readonly AgentManifestDefinition[] {
    const snapshot = this.resolveEffectiveSnapshot(paths, projectRoot);
    let sorted = this.sortedDefinitions.get(snapshot);
    if (!sorted) {
      sorted = Object.freeze(snapshot.profiles
        .slice()
        .sort((left, right) => Number(right.userInvocable) - Number(left.userInvocable) || left.name.localeCompare(right.name)));
      this.sortedDefinitions.set(snapshot, sorted);
    }
    return sorted;
  }

  getSettings(
    paths: Pick<AppRuntimePaths, 'agentsPath' | 'instructionsPath'>,
    providers: LlmProviderEntry[],
    routes: LlmAgentRoute[],
    catalogs: EffectiveCatalogSnapshot[] = [],
    projectRoot?: string,
  ): AgentManifestSettings {
    return {
      directoryPath: this.getAgentsDirectory(paths),
      definitions: [...this.definitions(paths, projectRoot)],
      modelOptions: this.getModelOptions(providers, routes, catalogs),
      globalInstructions: this.readGlobalInstructions(paths),
      diagnostics: [...this.resolveEffectiveSnapshot(paths, projectRoot).diagnostics],
    };
  }

  getEffectiveProfiles(
    paths: Pick<AppRuntimePaths, 'agentsPath' | 'instructionsPath'>,
    projectRoot?: string,
  ): readonly EffectiveAgentProfile[] {
    return this.resolveEffectiveSnapshot(paths, projectRoot).profiles;
  }

  saveGlobalInstructions(
    paths: Pick<AppRuntimePaths, 'instructionsPath'>,
    globalInstructions: string,
  ): void {
    fs.writeFileSync(this.getGlobalInstructionsPath(paths), globalInstructions.trim(), 'utf8');
    this.globalInstructions.get(this.getGlobalInstructionsPath(paths))?.invalidate();
  }

  async saveDefinition(
    paths: Pick<AppRuntimePaths, 'agentsPath' | 'instructionsPath'>,
    draft: AgentManifestDraft,
    options: AgentManifestSaveOptions = { scope: 'user' },
  ): Promise<AgentManifestCommit> {
    if (options.scope !== 'user' && options.scope !== 'project') {
      throw new AppError('AGENT_MANIFEST_SCOPE_REQUIRED', 'save/delete must specify user or project.');
    }
    const agentId = draft.id || toSlug(draft.name);
    if (!isSafeAgentProfileId(agentId)) {
      throw new Error(`Invalid agent profile id: ${agentId}`);
    }
    if (isReservedAgentId(agentId)) {
      throw new AppError('AGENT_ID_RESERVED_HISTORICAL', `${agentId} cannot be saved as a current profile.`);
    }
    if (agentId === GENERAL_AGENT_ID && !draft.delete && draft.enabled === false) {
      throw new AppError('AGENT_DEFAULT_REQUIRED', 'General is the default Agent and cannot be switched off.');
    }
    const directory = options.scope === 'project'
      ? this.resolveProjectAgentsPath(options.projectRoot)
      : this.getAgentsDirectory(paths);
    if (options.scope === 'user' && path.resolve(directory) === path.resolve(appPathService.getBuiltinAgentsPath())) {
      throw new AppError('BUILTIN_AGENT_MANIFEST_READONLY', 'edit requires an explicit user copy-on-write.');
    }
    await fs.promises.mkdir(directory, { recursive: true });
    // A save compares against the files as they are now, including edits made outside the app.
    this.revalidate();
    const fileName = safeFileNameForDraft(draft);
    const filePath = path.join(directory, fileName);
    const current = this.resolveEffectiveSnapshot(
      paths,
      options.scope === 'project' ? options.projectRoot : undefined,
    ).profiles.find((profile) => profile.id === agentId);
    if (options.sourceHash && current && current.provenance.sourceHash !== options.sourceHash) {
      throw new AppError('AGENT_MANIFEST_SOURCE_HASH_CONFLICT', 'the effective profile changed since the editor loaded.');
    }
    // A copy of the current builtin records which builtin version it was taken from.
    const basedOn = draft.basedOn ?? (current?.provenance.scope === 'builtin' ? current.provenance.sourceHash : undefined);
    const resolutionRoot = options.scope === 'project' ? options.projectRoot : undefined;
    if (draft.delete) {
      if (current?.provenance.scope === 'builtin' && options.scope === 'user') {
        throw new AppError('BUILTIN_AGENT_MANIFEST_READONLY', 'deleting a builtin profile is not allowed.');
      }
      await fs.promises.rm(filePath, { force: true });
      this.invalidate();
      if (options.scope === 'project') projectAgentTrust.revoke(options.projectRoot!, agentId);
      return {
        definition: this.resolveEffectiveDefinition(paths, agentId, resolutionRoot),
        commitHash: hashManifestContent(`deleted:${agentId}`),
      };
    }

    const parsed = parseAgentMarkdownStrict(
      serializeAgentMarkdown({ ...draft, id: agentId, fileName, ...(basedOn ? { basedOn } : {}) }),
      filePath,
      agentId,
      new Date().toISOString(),
      false,
    );
    if (!parsed.ok) {
      throw new AppError('AGENT_MANIFEST_INVALID', parsed.reason);
    }
    const content = serializeAgentMarkdown({
      ...draft,
      id: agentId,
      fileName,
      ...(basedOn ? { basedOn } : {}),
    });
    await writeFileAtomic(filePath, content);
    this.invalidate();

    const ownedFileName = fileNameForId(agentId);
    if (path.basename(filePath) !== ownedFileName) {
      throw new AppError('AGENT_MANIFEST_FILENAME_MISMATCH', `write path must be ${ownedFileName}.`);
    }
    // The user wrote these bytes through Settings; trust exactly them in this project.
    if (options.scope === 'project') projectAgentTrust.trust(options.projectRoot!, agentId, filePath);
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
      throw new AppError('AGENT_MANIFEST_PROJECT_ROOT_REQUIRED', 'project-scoped save needs a project root.');
    }
    return appPathService.getProjectRdcPaths(projectRoot).agentsPath;
  }

  async readCommitHash(filePath: string): Promise<string> {
    return hashManifestContent(await fs.promises.readFile(filePath, 'utf8'));
  }

  async readDefinition(
    paths: Pick<AppRuntimePaths, 'agentsPath'>,
    agentId: string,
    options?: { scope?: 'user' | 'project'; projectRoot?: string },
  ): Promise<AgentManifestDefinition | null> {
    if (isReservedAgentId(agentId)) return null;
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

  /**
   * The override file behind a current diagnostic with `code`. The renderer only names a path;
   * main accepts it only when its own snapshot reports that diagnostic for that file.
   */
  resolveDiagnosedOverride(
    paths: Pick<AppRuntimePaths, 'agentsPath' | 'instructionsPath'>,
    sourcePath: string,
    code: string,
    projectRoot?: string,
  ): { agentId: string; scope: AgentManifestWriteScope; sourcePath: string; sourceHash: string } {
    this.revalidate();
    const diagnostic = this.resolveEffectiveSnapshot(paths, projectRoot).diagnostics.find((issue) => (
      issue.code === code && issue.scope !== 'builtin' && samePath(issue.sourcePath, sourcePath)
    ));
    if (!diagnostic || diagnostic.scope === 'builtin') {
      throw new AppError('AGENT_OVERRIDE_NOT_DIAGNOSED', `${sourcePath} has no current ${code} diagnostic.`);
    }
    return { agentId: diagnostic.agentId, scope: diagnostic.scope, sourcePath: diagnostic.sourcePath, sourceHash: hashManifestFile(diagnostic.sourcePath) };
  }

  /** The current builtin and the effective user/project override of one Agent. */
  readBuiltinComparison(
    paths: Pick<AppRuntimePaths, 'agentsPath' | 'instructionsPath'>,
    agentId: string,
    projectRoot?: string,
  ): AgentBuiltinComparison {
    this.revalidate();
    const profile = this.resolveEffectiveSnapshot(paths, projectRoot).profiles.find((entry) => entry.id === agentId);
    const builtinPath = path.join(appPathService.getBuiltinAgentsPath(), `${agentId}.agent.md`);
    if (!profile || profile.provenance.scope === 'builtin' || !profile.builtinUpdate || !fs.existsSync(builtinPath)) {
      throw new AppError('AGENT_BUILTIN_COMPARISON_UNAVAILABLE', `${agentId} does not override a builtin profile.`);
    }
    return {
      agentId,
      builtinContent: fs.readFileSync(builtinPath, 'utf8'),
      overrideContent: fs.readFileSync(profile.provenance.sourcePath, 'utf8'),
    };
  }

  /** The route an Agent resolves to from Settings → Agents; empty when no model is configured. */
  routeForAgent(agentId: string): LlmAgentRoute {
    const model = resolveAgentModel(agentId, this.readAgentModels()).route;
    return { agentId, providerId: model?.providerId ?? '', modelId: model?.modelId ?? '' };
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
      if (definition.delete || !isSafeAgentProfileId(definition.id) || isReservedAgentId(definition.id)) {
        continue;
      }
      routeAgentIds.add(definition.id);
      // Preserve the explicit canonical route. EffectiveCatalog is the only
      // authority that may accept or reject the model at execution time.
      routeMap.set(definition.id, this.routeForAgent(definition.id));
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
      modelOptions: this.getModelOptions(providers, routes, catalogs),
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
          provider.enabled
          && provider.isConfigured
        ))
        .map((provider) => provider.id),
    ])];
  }

  private getModelOptions(
    providers: LlmProviderEntry[],
    routes: LlmAgentRoute[],
    catalogs: EffectiveCatalogSnapshot[],
  ): AgentModelOption[] {
    const agentModels = this.readAgentModels();
    const referenced = new Set([
      ...[agentModels.default, ...Object.values(agentModels.byAgent)].map((binding) => binding.model ?? '').filter(Boolean),
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
    const providerIssue = (provider: LlmProviderEntry): Pick<AgentModelOption, 'providerIssue' | 'disabledReason'> => {
      const state = provider.status === 'unconfigured' || provider.status === 'failed'
        ? provider.status : 'unavailable';
      const detail = state === 'failed' ? provider.lastError : state === 'unavailable' ? provider.unavailableReason : undefined;
      return { providerIssue: state, ...(detail ? { disabledReason: detail } : {}) };
    };
    const fromEffectiveModel = (provider: LlmProviderEntry, model: EffectiveModel): AgentModelOption => {
      const canonicalId = canonicalAgentModelId(provider.id, model.modelId);
      const providerUnavailable = !isProviderExecutable(provider);
      const modelDisabled = model.enabled === false;
      const eligibility = classifyAgentToolEligibility(model);
      const toolExecutable = eligibility === 'executable';
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
        ? undefined
        : status === 'model-disabled'
          ? 'Model is disabled.'
          : status === 'model-unavailable'
            ? eligibility === 'unsupported'
              ? 'This provider route explicitly does not support native structured agent tools.'
              : eligibility === 'no-adapter'
                ? 'This provider route has no implemented native structured-tool adapter.'
                : model.unavailableReason ?? 'Model is unavailable for this account and route.'
            : status === 'model-unverified'
              ? eligibility === 'budget-unknown'
                ? 'Model has no verified positive context budget and cannot be executed safely.'
                : eligibility === 'tools-unknown'
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
        reasoningSelections: model.controls.reasoning.kind === 'unknown'
          ? null : getReasoningSelectionOrder(model.controls.reasoning),
        ...(status === 'provider-unavailable' ? providerIssue(provider) : disabledReason ? { disabledReason } : {}),
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
          const executable = isAgentToolExecutableModel(model);
          if (executable || referenced.has(canonicalId)) {
            addOption(fromEffectiveModel(provider, model));
          }
        }
        continue;
      }
      const snapshot = catalogs.find((catalog) => (
        catalog.providerId === provider.id
        && catalog.accountId === (provider.activeAccountId ?? `anonymous:${provider.id}`)
        && catalog.protocol === provider.protocol
      ));
      for (const model of provider.models) {
        const canonicalId = canonicalAgentModelId(provider.id, model.id);
        const effective = snapshot?.models.find((entry) => (
          entry.modelId === model.id || entry.aliases.includes(model.id)
        ));
        if (effective) {
          const executable = isAgentToolExecutableModel(effective);
          if (executable || referenced.has(canonicalId)) {
            addOption(fromEffectiveModel(provider, effective));
          }
          continue;
        }
        if (!referenced.has(canonicalId)) continue;
        const providerUnavailable = !isProviderExecutable(provider);
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
            ? providerIssue(provider)
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
        ...(provider && !isProviderExecutable(provider)
          ? { status: 'provider-unavailable' as const, ...providerIssue(provider) }
          : { status: 'missing' as const, disabledReason: 'This model is not present in the current account catalog.' }),
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
    let value = this.globalInstructions.get(filePath);
    if (!value) {
      value = new StampedValue(() => fileStamp(filePath), () => (fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : ''));
      this.globalInstructions.set(filePath, value);
    }
    return value.get();
  }
}

export const agentManifestService = new AgentManifestService();

import * as fs from 'fs';
import * as path from 'path';
import { generateShortId, nowMs, sanitizeToken } from '@shared/utils/id';
import { writeYaml } from '@shared/utils/yaml';
import type { ProjectInputRecord, ProjectRecord } from '@shared/types/session';
import { appPathService } from '../runtime/AppPathService';
import type { ProjectRegistry, SelectionState } from './storageTypes';
import { PROJECT_REGISTRY_MIGRATIONS, SelectionStateSchema } from './storageSchema';
import { withDirectoryFileLockSync } from './directoryFileLock';
import { hashCaptureFile } from '../captures/replay/captureContentHash';
import { safePath } from '../captures/replay/replayFileSafety';


export class ProjectWorkspaceStore {
  private readonly verifiedInputs = new Map<string, { fingerprint: string; sha256: string }>();
  private readonly inputRefreshes = new Map<string, Promise<ProjectInputRecord[]>>();
  private inputReconciler?: (project: ProjectRecord, inputs: ProjectInputRecord[]) => Promise<void>;
  private inputCommitListener?: (projectId: string, inputs: ProjectInputRecord[]) => void;
  constructor(private readonly host: import('./storageHost').StorageHost) {}

  setInputReconciler(callback: (project: ProjectRecord, inputs: ProjectInputRecord[]) => Promise<void>): void {
    this.inputReconciler = callback;
  }
  setInputCommitListener(callback: (projectId: string, inputs: ProjectInputRecord[]) => void): void {
    this.inputCommitListener = callback;
  }

  getWorkspacePath(): string {
    this.syncRuntimePaths();
    return this.host.dataRootPath;
  }

  getGlobalKnowledgePath(): string {
    this.syncRuntimePaths();
    return this.host.globalKnowledgePath;
  }

  async initializeWorkspace(): Promise<void> {
    this.syncRuntimePaths();
    this.host.io.ensureDir(this.host.dataRootPath);
    this.host.io.ensureDir(this.host.projectsRootPath);
    this.ensureRegistry();
    this.ensureSelection();
    this.host.io.ensureDir(this.host.globalKnowledgePath);
    this.host.history.recoverConversationTurnCommits();
  }

  listProjects(): ProjectRecord[] {
    return this.readRegistry().projects
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async createProject(rootPath: string): Promise<ProjectRecord> {
    const resolvedRootPath = path.resolve(rootPath);
    if (!fs.existsSync(resolvedRootPath) || !fs.statSync(resolvedRootPath).isDirectory()) {
      throw new Error(`Project root is not a directory: ${resolvedRootPath}`);
    }
    const normalizedRootPath = fs.realpathSync.native(resolvedRootPath);
    const projectName = path.basename(normalizedRootPath) || normalizedRootPath;
    const { resourcePath, knowledgePath, inputsPath } = this.ensureProjectResourceLayout(normalizedRootPath);
    const inputs = await this.collectProjectInputs(inputsPath);
    const timestamp = nowMs();
    let result: ProjectRecord | undefined;
    this.mutateRegistry((registry) => {
      const existing = registry.projects.find((project) => project.rootPath === normalizedRootPath);
      if (existing) {
        result = existing;
        return;
      }
      const project: ProjectRecord = {
        projectId: `proj_${generateShortId()}`,
        name: projectName,
        rootPath: normalizedRootPath,
        slug: this.createUniqueProjectSlug(projectName, registry.projects),
        resourcePath,
        knowledgePath,
        inputsPath,
        inputs,
        inputsUpdatedAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      registry.projects.push(project);
      result = project;
    });
    if (!result) {
      throw new Error(`Failed to create project: ${normalizedRootPath}`);
    }
    this.host.io.ensureDir(this.getProjectDataPath(result));
    this.host.io.ensureDir(this.getProjectSessionsRoot(result));
    this.writeProjectMetadata(result);
    this.setCurrentProjectId(result.projectId);
    return result;
  }

  renameProject(projectId: string, newName: string): ProjectRecord {
    let target: ProjectRecord | undefined;
    this.mutateRegistry((registry) => {
      target = registry.projects.find((project) => project.projectId === projectId);
      if (!target) {
        throw new Error(`Project not found: ${projectId}`);
      }
      target.name = newName;
      target.updatedAt = nowMs();
    });
    if (!target) {
      throw new Error(`Project not found: ${projectId}`);
    }
    this.writeProjectMetadata(target);
    return target;
  }

  removeProject(projectId: string): void {
    let target: ProjectRecord | undefined;
    this.mutateRegistry((registry) => {
      target = registry.projects.find((project) => project.projectId === projectId);
      if (!target) return;
      registry.projects = registry.projects.filter((project) => project.projectId !== projectId);
    });
    if (!target) return;

    const projectPath = this.getProjectDataPath(target);
    if (fs.existsSync(projectPath)) {
      fs.rmSync(projectPath, { recursive: true, force: true });
    }

    const selection = this.readSelection();
    if (selection.projectId === projectId) {
      selection.projectId = null;
      selection.sessionId = null;
      this.writeSelection(selection);
    }
  }

  getProjectById(projectId: string): ProjectRecord | null {
    return this.readRegistry().projects.find((project) => project.projectId === projectId) || null;
  }

  async listProjectInputs(projectId: string): Promise<ProjectInputRecord[]> {
    const project = this.getProjectById(projectId);
    if (!project) return [];
    return this.refreshProjectInputs(projectId);
  }

  async refreshProjectInputs(projectId: string): Promise<ProjectInputRecord[]> {
    const previous = this.inputRefreshes.get(projectId) ?? Promise.resolve([]);
    const next = previous.catch(() => []).then(() => this.refreshInputsNow(projectId));
    this.inputRefreshes.set(projectId, next);
    try { return await next; } finally { if (this.inputRefreshes.get(projectId) === next) this.inputRefreshes.delete(projectId); }
  }

  private async refreshInputsNow(projectId: string): Promise<ProjectInputRecord[]> {
    const project = this.getProjectById(projectId);
    if (!project) return [];

    await fs.promises.access(project.rootPath);
    await safePath(project.rootPath, project.inputsPath);
    const normalizedProject = this.normalizeProjectRecord(project);
    const inputs = await this.collectProjectInputs(normalizedProject.inputsPath);
    const nextProject: ProjectRecord = {
      ...normalizedProject,
      inputs,
      inputsUpdatedAt: nowMs(),
    };
    if (this.inputReconciler) nextProject.replayCleanupPending = {
      requestedAt: project.replayCleanupPending?.requestedAt ?? nowMs(),
      captureHashes: [...new Set([...project.inputs.flatMap(input => input.contentSha256 ? [input.contentSha256] : []),
        ...(project.replayCleanupPending?.captureHashes ?? [])])],
    };
    // A complete filesystem scan defines the active inputs even if subsequent native/cache cleanup fails.
    this.persistProject(nextProject);
    this.inputCommitListener?.(projectId, inputs);
    if (this.inputReconciler) {
      try {
        await this.inputReconciler(project, inputs);
        delete nextProject.replayCleanupPending;
        this.persistProject(nextProject);
      } catch (error) {
        nextProject.replayCleanupPending = { ...nextProject.replayCleanupPending!, error: error instanceof Error ? error.message : String(error) };
        this.persistProject(nextProject);
        throw error;
      }
    }
    return nextProject.inputs;
  }

  async importProjectInputs(projectId: string, filePaths: string[]): Promise<ProjectInputRecord[]> {
    const project = this.getProjectById(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const normalizedProject = this.normalizeProjectRecord(project);
    this.host.io.ensureDir(normalizedProject.inputsPath);

    for (const filePath of filePaths) {
      const sourcePath = path.resolve(filePath);
      if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
        continue;
      }
      if (path.extname(sourcePath).toLowerCase() !== '.rdc') {
        continue;
      }

      const targetPath = this.resolveImportedInputPath(normalizedProject.inputsPath, path.basename(sourcePath));
      fs.copyFileSync(sourcePath, targetPath);
    }

    return this.refreshProjectInputs(projectId);
  }

  getCurrentProjectId(): string | null {
    return this.readSelection().projectId;
  }

  setCurrentProjectId(projectId: string | null): void {
    const selection = this.readSelection();
    selection.projectId = projectId;
    if (!projectId) {
      selection.sessionId = null;
    } else if (selection.sessionId) {
      const selectedSession = this.host.sessions.readSession(selection.sessionId);
      if (!selectedSession || selectedSession.projectId !== projectId) {
        selection.sessionId = null;
      }
    }
    this.writeSelection(selection);
  }

  async getCurrentSessionId(): Promise<string | null> {
    return this.readSelection().sessionId;
  }

  async setCurrentSessionId(sessionId: string | null): Promise<void> {
    const selection = this.readSelection();
    selection.sessionId = sessionId;
    if (sessionId) {
      const session = this.host.sessions.readSession(sessionId);
      if (session) {
        selection.projectId = session.projectId;
      }
    }
    this.writeSelection(selection);
  }

  syncRuntimePaths(): void {
    const paths = appPathService.getRuntimePaths();
    this.host.dataRootPath = paths.appStateRoot;
    this.host.projectsRootPath = paths.projectsPath;
    this.host.globalKnowledgePath = paths.knowledgePath;
    this.host.registryPath = path.join(this.host.projectsRootPath, 'registry.json');
    this.host.selectionPath = path.join(this.host.projectsRootPath, 'selection.json');
  }

  private ensureRegistry(): void {
    if (fs.existsSync(this.host.registryPath)) {
      return;
    }

    this.writeRegistry({
      schemaVersion: '1',
      projects: [],
    });
  }

  private ensureSelection(): void {
    if (fs.existsSync(this.host.selectionPath)) {
      return;
    }

    this.host.io.writeJsonAtomic(this.host.selectionPath, {
      projectId: null,
      sessionId: null,
    } satisfies SelectionState);
  }

  readRegistry(): ProjectRegistry {
    return this.withRegistryLock(() => {
      const loaded = this.host.io.readJson(this.host.registryPath, PROJECT_REGISTRY_MIGRATIONS);
      if (!loaded) {
        const empty: ProjectRegistry = {
          schemaVersion: '1',
          projects: [],
        };
        this.persistRegistryUnlocked(empty);
        return empty;
      }

      const registry: ProjectRegistry = {
        schemaVersion: loaded.schemaVersion,
        projects: loaded.projects,
      };
      const normalizedProjects = registry.projects.map((project) => this.normalizeProjectRecord(project));
      const changed = JSON.stringify(normalizedProjects) !== JSON.stringify(registry.projects);
      registry.projects = normalizedProjects;
      if (changed) {
        this.persistRegistryUnlocked(registry);
      }
      return registry;
    });
  }

  writeRegistry(registry: ProjectRegistry): void {
    this.withRegistryLock(() => this.persistRegistryUnlocked(registry));
  }

  private withRegistryLock<T>(operation: () => T): T {
    return withDirectoryFileLockSync(path.dirname(this.host.registryPath), {
      lockFileName: '.registry.lock',
      timeoutCode: 'PROJECT_REGISTRY_LOCK_TIMEOUT',
    }, operation);
  }

  private loadRegistryUnlocked(): ProjectRegistry {
    const loaded = this.host.io.readJson(this.host.registryPath, PROJECT_REGISTRY_MIGRATIONS);
    if (!loaded) {
      return {
        schemaVersion: '1',
        projects: [],
      };
    }
    return {
      schemaVersion: loaded.schemaVersion,
      projects: loaded.projects.map((project) => this.normalizeProjectRecord(project)),
    };
  }

  private persistRegistryUnlocked(registry: ProjectRegistry): void {
    this.host.io.writeJsonAtomic(this.host.registryPath, registry);
  }

  private mutateRegistry(mutator: (registry: ProjectRegistry) => void): ProjectRegistry {
    return this.withRegistryLock(() => {
      const registry = this.loadRegistryUnlocked();
      mutator(registry);
      this.persistRegistryUnlocked(registry);
      return registry;
    });
  }

  readSelection(): SelectionState {
    const loaded = this.host.io.readJson(this.host.selectionPath, SelectionStateSchema);
    if (!loaded) {
      const empty: SelectionState = {
        projectId: null,
        sessionId: null,
      };
      this.writeSelection(empty);
      return empty;
    }
    return {
      projectId: typeof loaded.projectId === 'string' || loaded.projectId === null ? loaded.projectId : null,
      sessionId: typeof loaded.sessionId === 'string' || loaded.sessionId === null ? loaded.sessionId : null,
    };
  }

  writeSelection(selection: SelectionState): void {
    this.host.io.writeJsonAtomic(this.host.selectionPath, selection);
  }

  writeProjectMetadata(project: ProjectRecord): void {
    const normalizedProject = this.normalizeProjectRecord(project);
    this.host.io.ensureDir(this.getProjectDataPath(normalizedProject));
    this.host.io.writeJsonAtomic(path.join(this.getProjectDataPath(normalizedProject), 'project.json'), normalizedProject);
    const projectPaths = appPathService.initializeProjectRdx(normalizedProject.rootPath);
    writeYaml(projectPaths.projectMetadataPath, {
      schema_version: '1',
      name: normalizedProject.name,
    });
  }

  touchProject(projectId: string, lastSessionId?: string | null, updatedAt: number = nowMs()): void {
    let project: ProjectRecord | undefined;
    this.mutateRegistry((registry) => {
      registry.projects = registry.projects.map((entry) => {
        if (entry.projectId !== projectId) return entry;
        const nextLastSessionId = lastSessionId === undefined
          ? entry.lastSessionId
          : lastSessionId || undefined;
        return {
          ...entry,
          updatedAt,
          lastSessionId: nextLastSessionId,
        };
      });
      project = registry.projects.find((item) => item.projectId === projectId);
    });
    if (project) {
      this.writeProjectMetadata(project);
    }
  }

  getProjectDataPath(project: ProjectRecord | string): string {
    const target = typeof project === 'string' ? this.getProjectById(project) : project;
    if (!target) {
      throw new Error(`Project not found: ${project}`);
    }
    return path.join(this.host.projectsRootPath, target.slug);
  }

  getProjectSessionsRoot(project: ProjectRecord | string): string {
    const target = typeof project === 'string' ? this.getProjectById(project) : project;
    if (!target) {
      throw new Error(`Project not found: ${project}`);
    }
    return path.join(appPathService.getAppStatePaths().sessionsPath, target.projectId);
  }

  ensureProjectSessionsRoot(project: ProjectRecord | string): string {
    const target = typeof project === 'string' ? this.getProjectById(project) : project;
    if (!target) {
      throw new Error(`Project not found: ${project}`);
    }

    const sessionsRoot = this.getProjectSessionsRoot(target);
    this.host.io.ensureDir(sessionsRoot);

    return sessionsRoot;
  }

  private createUniqueProjectSlug(projectName: string, existingProjects: ProjectRecord[]): string {
    const baseSlug = sanitizeToken(projectName.toLowerCase()) || 'project';
    const existingSlugs = new Set(existingProjects.map((project) => project.slug));
    if (!existingSlugs.has(baseSlug)) {
      return baseSlug;
    }

    let counter = 2;
    while (existingSlugs.has(`${baseSlug}-${counter}`)) {
      counter += 1;
    }
    return `${baseSlug}-${counter}`;
  }

  persistProject(project: ProjectRecord): void {
    this.mutateRegistry((registry) => {
      registry.projects = registry.projects.map((entry) => (
        entry.projectId === project.projectId ? project : entry
      ));
    });
    this.writeProjectMetadata(project);
  }

  private ensureProjectResourceLayout(rootPath: string): {
    resourcePath: string;
    knowledgePath: string;
    inputsPath: string;
  } {
    const projectPaths = appPathService.initializeProjectRdx(rootPath);
    return {
      resourcePath: projectPaths.projectRdxRoot,
      knowledgePath: projectPaths.knowledgePath,
      inputsPath: projectPaths.inputsPath,
    };
  }

  normalizeProjectRecord(project: ProjectRecord): ProjectRecord {
    const resolvedRoot = path.resolve(project.rootPath);
    let rootPath = resolvedRoot;
    try {
      if (fs.existsSync(resolvedRoot)) {
        rootPath = fs.realpathSync.native(resolvedRoot);
      }
    } catch {
      rootPath = resolvedRoot;
    }
    // Normalizing registry metadata must not recreate an offline or externally removed project.
    const projectPaths = appPathService.getProjectRdxPaths(rootPath);
    const resourcePath = projectPaths.projectRdxRoot;
    const { knowledgePath, inputsPath } = projectPaths;
    return {
      ...project,
      rootPath,
      resourcePath,
      knowledgePath,
      inputsPath,
      inputs: Array.isArray(project.inputs) ? project.inputs : [],
      inputsUpdatedAt: project.inputsUpdatedAt || nowMs(),
    };
  }

  private static readonly PROJECT_INPUTS_MAX_DEPTH = 8;
  private static readonly PROJECT_INPUTS_MAX_ENTRIES = 2000;
  private static readonly PROJECT_INPUTS_YIELD_EVERY = 64;

  private async collectProjectInputs(inputsPath: string): Promise<ProjectInputRecord[]> {
    const projectRoot = path.resolve(inputsPath, '..', '..');
    await fs.promises.access(projectRoot);
    await safePath(projectRoot, inputsPath);
    try { await fs.promises.access(inputsPath); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }

    const records: ProjectInputRecord[] = [];
    let visited = 0;

    const walk = async (dirPath: string, depth: number): Promise<void> => {
      if (depth > ProjectWorkspaceStore.PROJECT_INPUTS_MAX_DEPTH) {
        throw new Error(`PROJECT_INPUTS_BUDGET_EXCEEDED: maxDepth ${ProjectWorkspaceStore.PROJECT_INPUTS_MAX_DEPTH} exceeded under ${inputsPath}`);
      }
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        visited += 1;
        if (visited > ProjectWorkspaceStore.PROJECT_INPUTS_MAX_ENTRIES) {
          throw new Error(`PROJECT_INPUTS_BUDGET_EXCEEDED: maxEntries ${ProjectWorkspaceStore.PROJECT_INPUTS_MAX_ENTRIES} exceeded under ${inputsPath}`);
        }
        if (visited % ProjectWorkspaceStore.PROJECT_INPUTS_YIELD_EVERY === 0) {
          await new Promise<void>((resolve) => setImmediate(resolve));
        }

        const fullPath = path.join(dirPath, entry.name);
        await safePath(projectRoot, fullPath);
        if (entry.isSymbolicLink()) throw new Error('PROJECT_INPUTS_UNSAFE_LINK');
        if (entry.isDirectory()) {
          await walk(fullPath, depth + 1);
          continue;
        }
        if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.rdc') {
          continue;
        }

        const stats = await fs.promises.stat(fullPath);
        const fingerprint = `${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeMs}:${stats.ctimeMs}`;
        const cached = this.verifiedInputs.get(fullPath);
        const contentSha256 = cached?.fingerprint === fingerprint ? cached.sha256 : (await hashCaptureFile(fullPath)).sha256;
        this.verifiedInputs.set(fullPath, { fingerprint, sha256: contentSha256 });
        records.push({
          inputId: this.createProjectInputId(inputsPath, fullPath),
          fileName: path.basename(fullPath),
          filePath: fullPath,
          source: 'project_resource',
          discoveredAt: stats.birthtimeMs || stats.ctimeMs || stats.mtimeMs,
          lastModifiedAt: stats.mtimeMs,
          size: stats.size,
          contentSha256,
        });
      }
    };

    await walk(inputsPath, 0);
    return records.sort((a, b) => a.fileName.localeCompare(b.fileName));
  }

  private createProjectInputId(inputsPath: string, filePath: string): string {
    const relativePath = path.relative(inputsPath, filePath).replace(/[\\/]+/g, '_');
    const sanitized = sanitizeToken(relativePath.toLowerCase().replace(/\.rdc$/i, ''));
    return `input_${sanitized || generateShortId()}`;
  }

  private resolveImportedInputPath(inputsPath: string, fileName: string): string {
    const extension = path.extname(fileName);
    const baseName = path.basename(fileName, extension);
    let candidate = path.join(inputsPath, fileName);
    let counter = 2;
    while (fs.existsSync(candidate)) {
      candidate = path.join(inputsPath, `${baseName}-${counter}${extension}`);
      counter += 1;
    }
    return candidate;
  }
}

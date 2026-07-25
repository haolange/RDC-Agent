import * as fs from 'fs';
import * as path from 'path';
import { generateShortId, nowMs, sanitizeToken } from '@shared/utils/id';
import { writeYaml } from '@shared/utils/yaml';
import type { ProjectInputRecord, ProjectRecord } from '@shared/types/session';
import { appPathService } from '../runtime/AppPathService';
import type { ProjectRegistry, SelectionState } from './storageTypes';


export class ProjectWorkspaceStore {
  constructor(private readonly host: import('./storageHost').StorageHost) {}

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

  createProject(rootPath: string): ProjectRecord {
    const normalizedRootPath = path.resolve(rootPath);
    if (!fs.existsSync(normalizedRootPath) || !fs.statSync(normalizedRootPath).isDirectory()) {
      throw new Error(`Project root is not a directory: ${normalizedRootPath}`);
    }

    const registry = this.readRegistry();
    const existing = registry.projects.find((project) => project.rootPath === normalizedRootPath);
    if (existing) {
      this.setCurrentProjectId(existing.projectId);
      return existing;
    }

    const projectName = path.basename(normalizedRootPath) || normalizedRootPath;
    const slug = this.createUniqueProjectSlug(projectName, registry.projects);
    const { resourcePath, knowledgePath, inputsPath } = this.ensureProjectResourceLayout(normalizedRootPath);
    const inputs = this.collectProjectInputs(inputsPath);

    const timestamp = nowMs();
    const project: ProjectRecord = {
      projectId: `proj_${generateShortId()}`,
      name: projectName,
      rootPath: normalizedRootPath,
      slug,
      resourcePath,
      knowledgePath,
      inputsPath,
      inputs,
      inputsUpdatedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    registry.projects.push(project);
    this.writeRegistry(registry);
    this.host.io.ensureDir(this.getProjectDataPath(project));
    this.host.io.ensureDir(this.getProjectSessionsRoot(project));
    this.writeProjectMetadata(project);
    this.setCurrentProjectId(project.projectId);

    return project;
  }

  renameProject(projectId: string, newName: string): ProjectRecord {
    const registry = this.readRegistry();
    const target = registry.projects.find((project) => project.projectId === projectId);
    if (!target) {
      throw new Error(`Project not found: ${projectId}`);
    }

    target.name = newName;
    target.updatedAt = nowMs();
    
    this.writeRegistry(registry);
    this.writeProjectMetadata(target);
    
    return target;
  }

  removeProject(projectId: string): void {
    const registry = this.readRegistry();
    const target = registry.projects.find((project) => project.projectId === projectId);
    if (!target) return;

    registry.projects = registry.projects.filter((project) => project.projectId !== projectId);
    this.writeRegistry(registry);

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

  listProjectInputs(projectId: string): ProjectInputRecord[] {
    const project = this.getProjectById(projectId);
    if (!project) return [];
    return this.refreshProjectInputs(projectId);
  }

  refreshProjectInputs(projectId: string): ProjectInputRecord[] {
    const project = this.getProjectById(projectId);
    if (!project) return [];

    const normalizedProject = this.normalizeProjectRecord(project);
    const inputs = this.collectProjectInputs(normalizedProject.inputsPath);
    const nextProject: ProjectRecord = {
      ...normalizedProject,
      inputs,
      inputsUpdatedAt: nowMs(),
    };
    this.persistProject(nextProject);
    return nextProject.inputs;
  }

  importProjectInputs(projectId: string, filePaths: string[]): ProjectInputRecord[] {
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

    this.host.io.writeJson(this.host.registryPath, {
      schemaVersion: '1',
      projects: [],
    } satisfies ProjectRegistry);
  }

  private ensureSelection(): void {
    if (fs.existsSync(this.host.selectionPath)) {
      return;
    }

    this.host.io.writeJson(this.host.selectionPath, {
      projectId: null,
      sessionId: null,
    } satisfies SelectionState);
  }

  readRegistry(): ProjectRegistry {
    const registry = this.host.io.readJson<ProjectRegistry>(this.host.registryPath) || {
      schemaVersion: '1',
      projects: [],
    };
    const normalizedProjects = registry.projects.map((project) => this.normalizeProjectRecord(project));
    const changed = JSON.stringify(normalizedProjects) !== JSON.stringify(registry.projects);

    if (changed) {
      registry.projects = normalizedProjects;
      this.writeRegistry(registry);
    } else {
      registry.projects = normalizedProjects;
    }

    return registry;
  }

  writeRegistry(registry: ProjectRegistry): void {
    this.host.io.writeJson(this.host.registryPath, registry);
  }

  readSelection(): SelectionState {
    return this.host.io.readJson<SelectionState>(this.host.selectionPath) || {
      projectId: null,
      sessionId: null,
    };
  }

  writeSelection(selection: SelectionState): void {
    this.host.io.writeJson(this.host.selectionPath, selection);
  }

  writeProjectMetadata(project: ProjectRecord): void {
    const normalizedProject = this.normalizeProjectRecord(project);
    this.host.io.ensureDir(this.getProjectDataPath(normalizedProject));
    this.host.io.writeJson(path.join(this.getProjectDataPath(normalizedProject), 'project.json'), normalizedProject);
    const projectPaths = appPathService.initializeProjectRdx(normalizedProject.rootPath);
    writeYaml(projectPaths.projectMetadataPath, {
      schema_version: '1',
      name: normalizedProject.name,
    });
  }

  touchProject(projectId: string, lastSessionId?: string | null, updatedAt: number = nowMs()): void {
    const registry = this.readRegistry();
    const nextProjects = registry.projects.map((project) => {
      if (project.projectId !== projectId) return project;
      const nextLastSessionId = lastSessionId === undefined
        ? project.lastSessionId
        : lastSessionId || undefined;
      return {
        ...project,
        updatedAt,
        lastSessionId: nextLastSessionId,
      };
    });

    registry.projects = nextProjects;
    this.writeRegistry(registry);

    const project = registry.projects.find((item) => item.projectId === projectId);
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
    const registry = this.readRegistry();
    registry.projects = registry.projects.map((entry) => entry.projectId === project.projectId ? project : entry);
    this.writeRegistry(registry);
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
    const rootPath = path.resolve(project.rootPath);
    const { resourcePath, knowledgePath, inputsPath } = this.ensureProjectResourceLayout(rootPath);
    const inputs = this.collectProjectInputs(inputsPath);
    return {
      ...project,
      rootPath,
      resourcePath,
      knowledgePath,
      inputsPath,
      inputs,
      inputsUpdatedAt: project.inputsUpdatedAt || nowMs(),
    };
  }

  private collectProjectInputs(inputsPath: string): ProjectInputRecord[] {
    if (!fs.existsSync(inputsPath)) {
      return [];
    }

    const records: ProjectInputRecord[] = [];
    const walk = (dirPath: string) => {
      for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
          continue;
        }
        if (path.extname(entry.name).toLowerCase() !== '.rdc') {
          continue;
        }

        const stats = fs.statSync(fullPath);
        records.push({
          inputId: this.createProjectInputId(inputsPath, fullPath),
          fileName: path.basename(fullPath),
          filePath: fullPath,
          source: 'project_resource',
          discoveredAt: stats.birthtimeMs || stats.ctimeMs || stats.mtimeMs,
          lastModifiedAt: stats.mtimeMs,
          size: stats.size,
        });
      }
    };

    walk(inputsPath);
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

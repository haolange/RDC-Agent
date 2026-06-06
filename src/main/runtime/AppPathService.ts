import fs from 'fs';
import path from 'path';
import { app } from 'electron';

export interface WorkspacePaths {
  workspaceRoot: string;
  defaultWorkspaceRoot: string;
  settingsPath: string;
  logsPath: string;
  logPath: string;
  projectsPath: string;
  knowledgePath: string;
  migrationOrphansPath: string;
  profilesPath: string;
  policiesPath: string;
  skillsPath: string;
  mcpPath: string;
  patternsPath: string;
  secretsPath: string;
  migrationReportsPath: string;
}

interface BootstrapState {
  workspaceRoot?: string;
}

const SETTINGS_FILE_NAME = 'settings.json';
const LOG_FILE_NAME = 'rdc-agent.log';
const sanitizePathSegment = (value: string): string => value.replace(/[^a-zA-Z0-9_-]/g, '-');

const normalizePath = (targetPath: string): string => path.resolve(targetPath);

const isSamePath = (left: string, right: string): boolean => {
  const normalizedLeft = normalizePath(left);
  const normalizedRight = normalizePath(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
};

export class AppPathService {
  private workspaceRootCache: string | null = null;

  private getUserDataRoot(): string {
    return normalizePath(process.env.RDC_AGENT_USER_DATA?.trim() || app.getPath('userData'));
  }

  private getBootstrapDir(): string {
    return this.getUserDataRoot();
  }

  private getBootstrapPath(): string {
    return path.join(this.getBootstrapDir(), 'workspace-bootstrap.json');
  }

  getDefaultWorkspaceRoot(): string {
    return normalizePath(process.env.RDC_AGENT_WORKSPACE?.trim() || path.join(this.getUserDataRoot(), 'workspace'));
  }

  getWorkspaceRoot(): string {
    if (this.workspaceRootCache) {
      return this.workspaceRootCache;
    }

    const bootstrapState = this.readBootstrapState();
    const workspaceRoot = normalizePath(bootstrapState.workspaceRoot || this.getDefaultWorkspaceRoot());
    this.workspaceRootCache = workspaceRoot;
    return workspaceRoot;
  }

  getWorkspacePaths(workspaceRoot = this.getWorkspaceRoot()): WorkspacePaths {
    const root = normalizePath(workspaceRoot);
    const logsPath = path.join(root, 'logs');

    return {
      workspaceRoot: root,
      defaultWorkspaceRoot: this.getDefaultWorkspaceRoot(),
      settingsPath: path.join(root, SETTINGS_FILE_NAME),
      logsPath,
      logPath: path.join(logsPath, LOG_FILE_NAME),
      projectsPath: path.join(root, 'projects'),
      knowledgePath: path.join(root, 'knowledge'),
      migrationOrphansPath: path.join(root, 'migration-orphans'),
      profilesPath: path.join(root, 'profiles'),
      policiesPath: path.join(root, 'policies'),
      skillsPath: path.join(root, 'skills'),
      mcpPath: path.join(root, 'mcp'),
      patternsPath: path.join(root, 'patterns'),
      secretsPath: path.join(root, 'secrets'),
      migrationReportsPath: path.join(root, 'migration-reports'),
    };
  }

  initializeWorkspaceRoot(): WorkspacePaths {
    const bootstrapState = this.readBootstrapState();
    const workspaceRoot = normalizePath(bootstrapState.workspaceRoot || this.getDefaultWorkspaceRoot());
    const paths = this.getWorkspacePaths(workspaceRoot);
    this.ensureWorkspaceStructure(paths);

    this.workspaceRootCache = paths.workspaceRoot;
    this.writeBootstrapState({
      workspaceRoot: paths.workspaceRoot,
    });
    return paths;
  }

  setWorkspaceRoot(nextRoot: string): WorkspacePaths {
    const currentRoot = this.getWorkspaceRoot();
    const resolvedRoot = normalizePath(nextRoot || this.getDefaultWorkspaceRoot());
    const nextPaths = this.getWorkspacePaths(resolvedRoot);

    this.ensureWorkspaceStructure(nextPaths);

    if (!isSamePath(currentRoot, resolvedRoot)) {
      this.copyWorkspaceData(currentRoot, resolvedRoot);
    }

    this.workspaceRootCache = resolvedRoot;
    this.writeBootstrapState({
      workspaceRoot: resolvedRoot,
    });
    return nextPaths;
  }

  resetWorkspaceRoot(): WorkspacePaths {
    return this.setWorkspaceRoot(this.getDefaultWorkspaceRoot());
  }

  getCapturePreviewDir(projectId: string): string {
    const paths = this.getWorkspacePaths();
    return path.join(paths.logsPath, 'capture-previews', sanitizePathSegment(projectId || 'default'));
  }

  getCapturePreviewPath(projectId: string, inputId: string): string {
    return path.join(
      this.getCapturePreviewDir(projectId),
      `${sanitizePathSegment(inputId || 'capture')}-latest.png`,
    );
  }

  private readBootstrapState(): BootstrapState {
    const bootstrapPath = this.getBootstrapPath();
    try {
      if (fs.existsSync(bootstrapPath)) {
        return JSON.parse(fs.readFileSync(bootstrapPath, 'utf8')) as BootstrapState;
      }
    } catch (error) {
      console.warn('[AppPathService] Failed to read bootstrap state:', error);
    }

    return {};
  }

  private writeBootstrapState(state: BootstrapState): void {
    const bootstrapPath = this.getBootstrapPath();
    fs.mkdirSync(path.dirname(bootstrapPath), { recursive: true });
    fs.writeFileSync(bootstrapPath, JSON.stringify(state, null, 2), 'utf8');
  }

  private ensureWorkspaceStructure(paths: WorkspacePaths): void {
    fs.mkdirSync(paths.workspaceRoot, { recursive: true });
    fs.mkdirSync(paths.logsPath, { recursive: true });
    fs.mkdirSync(paths.projectsPath, { recursive: true });
    fs.mkdirSync(paths.knowledgePath, { recursive: true });
    fs.mkdirSync(paths.migrationOrphansPath, { recursive: true });
    fs.mkdirSync(paths.profilesPath, { recursive: true });
    fs.mkdirSync(paths.policiesPath, { recursive: true });
    fs.mkdirSync(paths.skillsPath, { recursive: true });
    fs.mkdirSync(paths.mcpPath, { recursive: true });
    fs.mkdirSync(paths.patternsPath, { recursive: true });
    fs.mkdirSync(paths.secretsPath, { recursive: true });
    fs.mkdirSync(paths.migrationReportsPath, { recursive: true });
  }

  private copyWorkspaceData(sourceRoot: string, targetRoot: string): void {
    if (!sourceRoot || !fs.existsSync(sourceRoot) || isSamePath(sourceRoot, targetRoot)) {
      return;
    }

    const targetPaths = this.getWorkspacePaths(targetRoot);

    this.copyFileIfMissing(path.join(sourceRoot, SETTINGS_FILE_NAME), targetPaths.settingsPath);
    this.copyDirContents(path.join(sourceRoot, 'projects'), targetPaths.projectsPath);
    this.copyDirContents(path.join(sourceRoot, 'knowledge'), targetPaths.knowledgePath);
    this.copyDirContents(path.join(sourceRoot, 'migration-orphans'), targetPaths.migrationOrphansPath);
    this.copyDirContents(path.join(sourceRoot, 'profiles'), targetPaths.profilesPath);
    this.copyDirContents(path.join(sourceRoot, 'policies'), targetPaths.policiesPath);
    this.copyDirContents(path.join(sourceRoot, 'skills'), targetPaths.skillsPath);
    this.copyDirContents(path.join(sourceRoot, 'mcp'), targetPaths.mcpPath);
    this.copyDirContents(path.join(sourceRoot, 'patterns'), targetPaths.patternsPath);
    this.copyDirContents(path.join(sourceRoot, 'secrets'), targetPaths.secretsPath);
    this.copyDirContents(path.join(sourceRoot, 'migration-reports'), targetPaths.migrationReportsPath);
    this.copyDirContents(path.join(sourceRoot, 'logs'), targetPaths.logsPath);
    this.copyLogFile(path.join(sourceRoot, LOG_FILE_NAME), targetPaths.logPath);
    this.copyLogFile(path.join(sourceRoot, 'dev-stdout.log'), targetPaths.logPath);
  }

  private copyDirContents(sourceDir: string, targetDir: string): void {
    if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
      return;
    }

    fs.mkdirSync(targetDir, { recursive: true });
    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
      const sourcePath = path.join(sourceDir, entry.name);
      const targetPath = path.join(targetDir, entry.name);

      if (entry.isDirectory()) {
        this.copyDirContents(sourcePath, targetPath);
        continue;
      }

      this.copyFileIfMissing(sourcePath, targetPath);
    }
  }

  private copyLogFile(sourcePath: string, targetPath: string): void {
    this.copyFileIfMissing(sourcePath, targetPath);
  }

  private copyFileIfMissing(sourcePath: string, targetPath: string): void {
    if (!fs.existsSync(sourcePath) || fs.existsSync(targetPath)) {
      return;
    }

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
  }
}

export const appPathService = new AppPathService();

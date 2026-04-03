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
}

interface BootstrapState {
  workspaceRoot?: string;
}

const SETTINGS_FILE_NAME = 'settings.json';
const LOG_FILE_NAME = 'rdc-agent.log';

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

  private getBootstrapDir(): string {
    return path.join(app.getPath('appData'), 'RdcAgent');
  }

  private getBootstrapPath(): string {
    return path.join(this.getBootstrapDir(), 'workspace-bootstrap.json');
  }

  getDefaultWorkspaceRoot(): string {
    return normalizePath(path.join(app.getPath('appData'), 'rdc-agent'));
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
    };
  }

  initializeWorkspaceRoot(): WorkspacePaths {
    const workspaceRoot = this.getWorkspaceRoot();
    const paths = this.getWorkspacePaths(workspaceRoot);
    this.ensureWorkspaceStructure(paths);
    this.copyLegacyData(paths.workspaceRoot);
    this.writeBootstrapState({ workspaceRoot: paths.workspaceRoot });
    return paths;
  }

  setWorkspaceRoot(nextRoot: string): WorkspacePaths {
    const currentRoot = this.getWorkspaceRoot();
    const resolvedRoot = normalizePath(nextRoot || this.getDefaultWorkspaceRoot());

    if (!isSamePath(currentRoot, resolvedRoot)) {
      this.ensureWorkspaceStructure(this.getWorkspacePaths(resolvedRoot));
      this.copyWorkspaceData(currentRoot, resolvedRoot);
      this.copyLegacyData(resolvedRoot);
    } else {
      this.ensureWorkspaceStructure(this.getWorkspacePaths(resolvedRoot));
      this.copyLegacyData(resolvedRoot);
    }

    this.workspaceRootCache = resolvedRoot;
    this.writeBootstrapState({ workspaceRoot: resolvedRoot });
    return this.getWorkspacePaths(resolvedRoot);
  }

  resetWorkspaceRoot(): WorkspacePaths {
    return this.setWorkspaceRoot(this.getDefaultWorkspaceRoot());
  }

  private readBootstrapState(): BootstrapState {
    const bootstrapPath = this.getBootstrapPath();
    try {
      if (!fs.existsSync(bootstrapPath)) {
        return {};
      }
      return JSON.parse(fs.readFileSync(bootstrapPath, 'utf8')) as BootstrapState;
    } catch (error) {
      console.warn('[AppPathService] Failed to read bootstrap state:', error);
      return {};
    }
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
  }

  private copyLegacyData(targetRoot: string): void {
    const legacyUserDataRoot = app.getPath('userData');
    const legacySettingsRoot = path.join(app.getPath('appData'), 'RdcAgent');
    const legacyDevWorkspace = path.join(app.getAppPath(), 'workspace');
    const legacyPackagedWorkspace = path.join(path.dirname(app.getPath('exe')), 'workspace');
    const legacyDevLog = path.join(app.getAppPath(), 'dev-stdout.log');

    this.copyWorkspaceData(legacyUserDataRoot, targetRoot);
    this.copyWorkspaceData(legacySettingsRoot, targetRoot);
    this.copyWorkspaceData(legacyDevWorkspace, targetRoot);
    this.copyWorkspaceData(legacyPackagedWorkspace, targetRoot);
    this.copyLogFile(legacyDevLog, this.getWorkspacePaths(targetRoot).logPath);
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

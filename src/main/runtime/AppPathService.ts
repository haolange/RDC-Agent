import fs from 'fs';
import os from 'os';
import path from 'path';
import { app } from 'electron';
import { resolveCanonicalUserDataPath } from './userDataPath';

export interface UserRdxPaths {
  userRdxRoot: string;
  configPath: string;
  instructionsPath: string;
  agentsPath: string;
  skillsPath: string;
  mcpPath: string;
  hooksPath: string;
  policiesPath: string;
  knowledgePath: string;
  memoryPath: string;
}

export interface ProjectRdxPaths {
  projectRoot: string;
  projectRdxRoot: string;
  projectMetadataPath: string;
  gitignorePath: string;
  agentsPath: string;
  skillsPath: string;
  mcpPath: string;
  hooksPath: string;
  policiesPath: string;
  knowledgePath: string;
  memoryPath: string;
  inputsPath: string;
  artifactsPath: string;
}

export interface AppStatePaths {
  appStateRoot: string;
  projectsPath: string;
  sessionsPath: string;
  tasksPath: string;
  tracesPath: string;
  llmCallsPath: string;
  secretsPath: string;
  logsPath: string;
  logPath: string;
  capturePreviewsPath: string;
  profileStatePath: string;
  attachmentStagingPath: string;
}

/**
 * Canonical aggregate used by main-process services that need both User Scope
 * resources and application-internal state paths.
 */
export interface RuntimePaths extends UserRdxPaths, AppStatePaths {
  settingsPath: string;
}

const CONFIG_FILE_NAME = 'config.json';
const LOG_FILE_NAME = 'rdc-agent.log';
const PROJECT_GITIGNORE = ['inputs/', 'artifacts/', 'memory/', 'runtime/', ''].join('\n');
const sanitizePathSegment = (value: string): string => value.replace(/[^a-zA-Z0-9_-]/g, '-');
const normalizePath = (targetPath: string): string => path.resolve(targetPath);

export class AppPathService {
  private runtimeInitMemo: { key: string; paths: RuntimePaths } | null = null;

  private getUserDataRoot(): string {
    const appDataRoot = app?.getPath?.('appData') || (process.platform === 'win32'
      ? path.join(os.homedir(), 'AppData', 'Roaming')
      : path.join(os.homedir(), '.config'));
    return resolveCanonicalUserDataPath(process.env.RDC_AGENT_USER_DATA, appDataRoot);
  }

  getUserRdxRoot(): string {
    return normalizePath(process.env.RDC_AGENT_HOME?.trim() || path.join(os.homedir(), '.rdx'));
  }

  /**
   * Builtin agent-runtime root: packaged app path, repo `resources/agent-runtime`,
   * then Electron `process.resourcesPath`. First existing candidate wins.
   */
  getBuiltinAgentRuntimeRoot(): string {
    const candidates = [
      path.join(app?.getAppPath?.() || process.cwd(), 'resources', 'agent-runtime'),
      path.join(process.cwd(), 'resources', 'agent-runtime'),
      path.join(process.resourcesPath ?? '', 'agent-runtime'),
    ];
    return candidates.map((candidate) => path.resolve(candidate)).find((candidate) => fs.existsSync(candidate))
      ?? path.resolve(candidates[0]);
  }

  getBuiltinAgentsPath(): string {
    return path.join(this.getBuiltinAgentRuntimeRoot(), 'agents');
  }

  getBuiltinSkillsPath(): string {
    return path.join(this.getBuiltinAgentRuntimeRoot(), 'skills');
  }

  getUserRdxPaths(): UserRdxPaths {
    const userRdxRoot = this.getUserRdxRoot();
    return {
      userRdxRoot,
      configPath: path.join(userRdxRoot, CONFIG_FILE_NAME),
      instructionsPath: path.join(userRdxRoot, 'RDX.md'),
      agentsPath: path.join(userRdxRoot, 'agents'),
      skillsPath: path.join(userRdxRoot, 'skills'),
      mcpPath: path.join(userRdxRoot, 'mcp'),
      hooksPath: path.join(userRdxRoot, 'hooks'),
      policiesPath: path.join(userRdxRoot, 'policies'),
      knowledgePath: path.join(userRdxRoot, 'knowledge'),
      memoryPath: path.join(userRdxRoot, 'memory'),
    };
  }

  getAppStatePaths(): AppStatePaths {
    const userDataRoot = this.getUserDataRoot();
    const appStateRoot = path.join(userDataRoot, 'state');
    const logsPath = path.join(userDataRoot, 'logs');
    return {
      appStateRoot,
      projectsPath: path.join(appStateRoot, 'projects'),
      sessionsPath: path.join(appStateRoot, 'sessions'),
      tasksPath: path.join(appStateRoot, 'tasks'),
      tracesPath: path.join(appStateRoot, 'traces'),
      llmCallsPath: path.join(appStateRoot, 'llm-calls'),
      secretsPath: path.join(userDataRoot, 'secrets'),
      logsPath,
      logPath: path.join(logsPath, LOG_FILE_NAME),
      capturePreviewsPath: path.join(userDataRoot, 'capture-previews'),
      profileStatePath: path.join(appStateRoot, 'profile'),
      attachmentStagingPath: path.join(appStateRoot, 'staging', 'attachments'),
    };
  }

  getProjectRdxPaths(projectRoot: string): ProjectRdxPaths {
    const resolvedProjectRoot = normalizePath(projectRoot);
    const projectRdxRoot = path.join(resolvedProjectRoot, '.rdx');
    return {
      projectRoot: resolvedProjectRoot,
      projectRdxRoot,
      projectMetadataPath: path.join(projectRdxRoot, 'project.yaml'),
      gitignorePath: path.join(projectRdxRoot, '.gitignore'),
      agentsPath: path.join(projectRdxRoot, 'agents'),
      skillsPath: path.join(projectRdxRoot, 'skills'),
      mcpPath: path.join(projectRdxRoot, 'mcp'),
      hooksPath: path.join(projectRdxRoot, 'hooks'),
      policiesPath: path.join(projectRdxRoot, 'policies'),
      knowledgePath: path.join(projectRdxRoot, 'knowledge'),
      memoryPath: path.join(projectRdxRoot, 'memory'),
      inputsPath: path.join(projectRdxRoot, 'inputs'),
      artifactsPath: path.join(projectRdxRoot, 'artifacts'),
    };
  }

  initializeRuntime(): RuntimePaths {
    const paths = this.getRuntimePaths();
    const memoKey = `${paths.userRdxRoot}\u0000${paths.appStateRoot}`;
    if (this.runtimeInitMemo?.key === memoKey) {
      return this.runtimeInitMemo.paths;
    }
    const directories = [
      paths.userRdxRoot,
      paths.agentsPath,
      paths.skillsPath,
      paths.mcpPath,
      paths.hooksPath,
      paths.policiesPath,
      paths.knowledgePath,
      paths.memoryPath,
      paths.appStateRoot,
      paths.projectsPath,
      paths.sessionsPath,
      paths.tasksPath,
      paths.tracesPath,
      paths.llmCallsPath,
      paths.secretsPath,
      paths.logsPath,
      paths.capturePreviewsPath,
      paths.profileStatePath,
      paths.attachmentStagingPath,
    ];
    directories.forEach((directory) => fs.mkdirSync(directory, { recursive: true }));
    this.runtimeInitMemo = { key: memoKey, paths };
    return paths;
  }

  initializeProjectRdx(projectRoot: string): ProjectRdxPaths {
    const paths = this.getProjectRdxPaths(projectRoot);
    [
      paths.projectRdxRoot,
      paths.agentsPath,
      paths.skillsPath,
      paths.mcpPath,
      paths.hooksPath,
      paths.policiesPath,
      paths.knowledgePath,
      paths.memoryPath,
      paths.inputsPath,
      paths.artifactsPath,
    ].forEach((directory) => fs.mkdirSync(directory, { recursive: true }));
    if (!fs.existsSync(paths.gitignorePath)) {
      fs.writeFileSync(paths.gitignorePath, PROJECT_GITIGNORE, 'utf8');
    }
    return paths;
  }

  getRuntimePaths(): RuntimePaths {
    const user = this.getUserRdxPaths();
    const state = this.getAppStatePaths();
    return {
      ...user,
      ...state,
      settingsPath: user.configPath,
    };
  }

  getCapturePreviewDir(projectId: string): string {
    return path.join(this.getAppStatePaths().capturePreviewsPath, sanitizePathSegment(projectId || 'default'));
  }

  getCapturePreviewPath(projectId: string, inputId: string): string {
    return path.join(this.getCapturePreviewDir(projectId), `${sanitizePathSegment(inputId || 'capture')}-latest.png`);
  }
}

export const appPathService = new AppPathService();

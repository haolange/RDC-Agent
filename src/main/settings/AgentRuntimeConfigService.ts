import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import type {
  AgentRuntimeMcpDescriptor,
  AgentRuntimePatternDescriptor,
  AgentRuntimeSkillDescriptor,
} from '@shared/types/agentRuntime';
import { appPathService } from '../runtime/AppPathService';

type RuntimeTemplateKind = 'patterns' | 'skills' | 'mcp';

const TEMPLATE_COPIES: Array<{ source: string[]; target: (workspaceRoot: string) => string }> = [
  {
    source: ['profiles', 'agents'],
    target: (workspaceRoot) => path.join(appPathService.getWorkspacePaths(workspaceRoot).profilesPath, 'agents'),
  },
  {
    source: ['profiles', 'modes'],
    target: (workspaceRoot) => path.join(appPathService.getWorkspacePaths(workspaceRoot).profilesPath, 'modes'),
  },
  {
    source: ['policies', 'stages'],
    target: (workspaceRoot) => path.join(appPathService.getWorkspacePaths(workspaceRoot).policiesPath, 'stages'),
  },
  {
    source: ['patterns'],
    target: (workspaceRoot) => appPathService.getWorkspacePaths(workspaceRoot).patternsPath,
  },
  {
    source: ['skills'],
    target: (workspaceRoot) => appPathService.getWorkspacePaths(workspaceRoot).skillsPath,
  },
  {
    source: ['mcp'],
    target: (workspaceRoot) => appPathService.getWorkspacePaths(workspaceRoot).mcpPath,
  },
];

function readJsonFile<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch (error) {
    console.warn('[AgentRuntimeConfigService] Failed to read JSON:', filePath, error);
    return null;
  }
}

function copyDirContentsIfMissing(sourceDir: string, targetDir: string): void {
  if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
    return;
  }
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyDirContentsIfMissing(sourcePath, targetPath);
      continue;
    }
    if (!entry.isFile() || fs.existsSync(targetPath)) {
      continue;
    }
    fs.copyFileSync(sourcePath, targetPath);
  }
}

export class AgentRuntimeConfigService {
  private resolveTemplateRoot(): string {
    const candidates = [
      path.join(app.getAppPath(), 'resources', 'agent-runtime'),
      path.join(app.getAppPath(), '..', 'resources', 'agent-runtime'),
      path.join(process.cwd(), 'resources', 'agent-runtime'),
      path.join(process.resourcesPath ?? '', 'resources', 'agent-runtime'),
      path.join(process.resourcesPath ?? '', 'agent-runtime'),
    ].filter(Boolean);

    for (const candidate of candidates) {
      const resolved = path.resolve(candidate);
      if (fs.existsSync(resolved)) {
        return resolved;
      }
    }

    return path.resolve(candidates[0]);
  }

  ensureScaffold(workspaceRoot = appPathService.getWorkspaceRoot()): void {
    const templateRoot = this.resolveTemplateRoot();
    for (const copy of TEMPLATE_COPIES) {
      copyDirContentsIfMissing(path.join(templateRoot, ...copy.source), copy.target(workspaceRoot));
    }
  }

  listPatterns(workspaceRoot = appPathService.getWorkspaceRoot()): AgentRuntimePatternDescriptor[] {
    return this.readDescriptors<AgentRuntimePatternDescriptor>('patterns', workspaceRoot);
  }

  listSkills(workspaceRoot = appPathService.getWorkspaceRoot()): AgentRuntimeSkillDescriptor[] {
    return this.readDescriptors<AgentRuntimeSkillDescriptor>('skills', workspaceRoot);
  }

  listMcpServers(workspaceRoot = appPathService.getWorkspaceRoot()): AgentRuntimeMcpDescriptor[] {
    return this.readDescriptors<AgentRuntimeMcpDescriptor>('mcp', workspaceRoot);
  }

  private readDescriptors<T extends { id: string }>(kind: RuntimeTemplateKind, workspaceRoot: string): T[] {
    this.ensureScaffold(workspaceRoot);
    const paths = appPathService.getWorkspacePaths(workspaceRoot);
    const dir = kind === 'patterns'
      ? paths.patternsPath
      : kind === 'skills'
        ? paths.skillsPath
        : paths.mcpPath;

    if (!fs.existsSync(dir)) {
      return [];
    }

    return fs.readdirSync(dir)
      .filter((entry) => entry.endsWith('.json'))
      .map((entry) => readJsonFile<T>(path.join(dir, entry)))
      .filter((entry): entry is T => Boolean(entry?.id))
      .sort((left, right) => left.id.localeCompare(right.id));
  }
}

export const agentRuntimeConfigService = new AgentRuntimeConfigService();

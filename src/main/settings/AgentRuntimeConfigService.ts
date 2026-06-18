import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import type {
  AgentRuntimeMcpDescriptor,
  AgentRuntimeMcpWriteRequest,
  AgentRuntimePatternDescriptor,
  AgentRuntimeSkillDescriptor,
  AgentRuntimeSkillWriteRequest,
} from '@shared/types/agentRuntime';
import type { MCPTransport } from '@shared/types/mcp';
import { appPathService } from '../runtime/AppPathService';

type RuntimeTemplateKind = 'patterns' | 'mcp';
const RETIRED_BUILTIN_MCP_SERVER_IDS = new Set(['builtin.rdc-toolbridge']);
// Migration cleanup only: canonical Skills are Markdown files. These ids remove old
// JSON skill descriptors from workspaces after the bundled templates were converted.
const RETIRED_SKILL_JSON_IDS = new Set(['builtin.rdc-context', 'builtin.renderdoc-glossary']);
const MCP_TRANSPORTS = new Set<MCPTransport>(['stdio', 'sse', 'streamable-http']);

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

function toRuntimeId(value: string, fallback = 'custom'): string {
  const id = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return id || fallback;
}

function titleFromId(id: string): string {
  return id
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ') || id;
}

function parseSkillMarkdown(filePath: string): AgentRuntimeSkillDescriptor | null {
  const raw = fs.readFileSync(filePath, 'utf8');
  const id = toRuntimeId(path.basename(filePath, '.md'), 'skill');
  const heading = raw.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const description = raw.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? '';
  const type = raw.match(/^type:\s*(.+)$/m)?.[1]?.trim();

  return {
    id,
    name: id,
    label: heading || titleFromId(id),
    description,
    source: 'workspace',
    enabledByDefault: true,
    path: filePath,
    parameters: {
      markdown: raw,
      ...(type ? { type } : {}),
    },
  };
}

function normalizeSkillMarkdown(request: AgentRuntimeSkillWriteRequest, id: string): string {
  const label = request.label.trim() || titleFromId(id);
  const description = request.description.trim();
  const input = request.markdown.trim();
  const withoutHeading = input.replace(/^#\s+.*(?:\r?\n)?/, '');
  const withoutDescription = withoutHeading.replace(/^description:\s*.*(?:\r?\n)?/m, '');
  const body = withoutDescription.trim() || 'type: prompt\npromptTemplate: |\n  Describe the reusable workflow or instruction here.';
  return `# ${label}\ndescription: ${description}\n${body}\n`;
}

function validateWithinDir(filePath: string, dir: string): string {
  const resolvedDir = path.resolve(dir);
  const resolvedFile = path.resolve(filePath);
  const relative = path.relative(resolvedDir, resolvedFile);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Runtime file path escaped the workspace directory.');
  }
  return resolvedFile;
}

function readEnvLines(env: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!env) return undefined;
  const entries = Object.entries(env)
    .map(([key, value]) => [key.trim(), String(value)] as const)
    .filter(([key]) => Boolean(key));
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
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
    this.removeRetiredSkillJsonFiles(workspaceRoot);
  }

  listPatterns(workspaceRoot = appPathService.getWorkspaceRoot()): AgentRuntimePatternDescriptor[] {
    return this.readDescriptors<AgentRuntimePatternDescriptor>('patterns', workspaceRoot);
  }

  listSkills(workspaceRoot = appPathService.getWorkspaceRoot()): AgentRuntimeSkillDescriptor[] {
    this.ensureScaffold(workspaceRoot);
    const dir = appPathService.getWorkspacePaths(workspaceRoot).skillsPath;
    if (!fs.existsSync(dir)) {
      return [];
    }

    return fs.readdirSync(dir)
      .filter((entry) => entry.endsWith('.md'))
      .map((entry) => parseSkillMarkdown(path.join(dir, entry)))
      .filter((entry): entry is AgentRuntimeSkillDescriptor => Boolean(entry?.id))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  listMcpServers(workspaceRoot = appPathService.getWorkspaceRoot()): AgentRuntimeMcpDescriptor[] {
    return this.readDescriptors<AgentRuntimeMcpDescriptor>('mcp', workspaceRoot)
      .filter((descriptor) => !RETIRED_BUILTIN_MCP_SERVER_IDS.has(descriptor.id));
  }

  upsertSkill(request: AgentRuntimeSkillWriteRequest, workspaceRoot = appPathService.getWorkspaceRoot()): void {
    this.ensureScaffold(workspaceRoot);
    const paths = appPathService.getWorkspacePaths(workspaceRoot);
    const nextId = toRuntimeId(request.id, 'skill');
    const targetPath = validateWithinDir(path.join(paths.skillsPath, `${nextId}.md`), paths.skillsPath);
    const previousId = request.previousId ? toRuntimeId(request.previousId, nextId) : nextId;
    const previousPath = validateWithinDir(path.join(paths.skillsPath, `${previousId}.md`), paths.skillsPath);
    fs.mkdirSync(paths.skillsPath, { recursive: true });
    fs.writeFileSync(targetPath, normalizeSkillMarkdown(request, nextId), 'utf8');
    if (previousId !== nextId && fs.existsSync(previousPath)) {
      fs.unlinkSync(previousPath);
    }
  }

  deleteSkill(id: string, workspaceRoot = appPathService.getWorkspaceRoot()): void {
    const paths = appPathService.getWorkspacePaths(workspaceRoot);
    const targetPath = validateWithinDir(path.join(paths.skillsPath, `${toRuntimeId(id, 'skill')}.md`), paths.skillsPath);
    if (fs.existsSync(targetPath)) {
      fs.unlinkSync(targetPath);
    }
  }

  importSkill(filePath: string, workspaceRoot = appPathService.getWorkspaceRoot()): void {
    if (!filePath.endsWith('.md')) {
      throw new Error('Skill import requires a .md file.');
    }
    this.ensureScaffold(workspaceRoot);
    const paths = appPathService.getWorkspacePaths(workspaceRoot);
    const baseId = toRuntimeId(path.basename(filePath, '.md'), 'skill');
    const targetPath = this.nextAvailableDescriptorPath(paths.skillsPath, baseId, '.md');
    fs.copyFileSync(filePath, targetPath);
  }

  upsertMcpServer(request: AgentRuntimeMcpWriteRequest, workspaceRoot = appPathService.getWorkspaceRoot()): void {
    this.ensureScaffold(workspaceRoot);
    const paths = appPathService.getWorkspacePaths(workspaceRoot);
    const id = toRuntimeId(request.id, 'mcp-server');
    const transport = MCP_TRANSPORTS.has(request.transport) ? request.transport : 'stdio';
    const descriptor: AgentRuntimeMcpDescriptor = {
      id,
      name: request.name.trim() || titleFromId(id),
      description: request.description.trim(),
      transport,
      enabledByDefault: request.enabledByDefault ?? true,
      ...(request.command?.trim() ? { command: request.command.trim() } : {}),
      ...(request.args && request.args.length > 0 ? { args: request.args.map((arg) => arg.trim()).filter(Boolean) } : {}),
      ...(request.url?.trim() ? { url: request.url.trim() } : {}),
      ...(readEnvLines(request.env) ? { env: readEnvLines(request.env) } : {}),
    };
    const targetPath = validateWithinDir(path.join(paths.mcpPath, `${id}.json`), paths.mcpPath);
    const previousId = request.previousId ? toRuntimeId(request.previousId, id) : id;
    const previousPath = validateWithinDir(path.join(paths.mcpPath, `${previousId}.json`), paths.mcpPath);
    fs.mkdirSync(paths.mcpPath, { recursive: true });
    fs.writeFileSync(targetPath, `${JSON.stringify(descriptor, null, 2)}\n`, 'utf8');
    if (previousId !== id && fs.existsSync(previousPath)) {
      fs.unlinkSync(previousPath);
    }
  }

  deleteMcpServer(id: string, workspaceRoot = appPathService.getWorkspaceRoot()): void {
    const paths = appPathService.getWorkspacePaths(workspaceRoot);
    const targetPath = validateWithinDir(path.join(paths.mcpPath, `${toRuntimeId(id, 'mcp-server')}.json`), paths.mcpPath);
    if (fs.existsSync(targetPath)) {
      fs.unlinkSync(targetPath);
    }
  }

  importMcpServer(filePath: string, workspaceRoot = appPathService.getWorkspaceRoot()): void {
    if (!filePath.endsWith('.json')) {
      throw new Error('MCP import requires a .json file.');
    }
    this.ensureScaffold(workspaceRoot);
    const parsed = readJsonFile<AgentRuntimeMcpDescriptor>(filePath);
    if (!parsed?.id || !MCP_TRANSPORTS.has(parsed.transport)) {
      throw new Error('MCP config is missing id or transport.');
    }
    const paths = appPathService.getWorkspacePaths(workspaceRoot);
    const targetPath = this.nextAvailableDescriptorPath(paths.mcpPath, toRuntimeId(parsed.id, 'mcp-server'), '.json');
    fs.copyFileSync(filePath, targetPath);
  }

  private readDescriptors<T extends { id: string }>(kind: RuntimeTemplateKind, workspaceRoot: string): T[] {
    this.ensureScaffold(workspaceRoot);
    const paths = appPathService.getWorkspacePaths(workspaceRoot);
    const dir = kind === 'patterns' ? paths.patternsPath : paths.mcpPath;

    if (!fs.existsSync(dir)) {
      return [];
    }

    return fs.readdirSync(dir)
      .filter((entry) => entry.endsWith('.json'))
      .map((entry) => readJsonFile<T>(path.join(dir, entry)))
      .filter((entry): entry is T => Boolean(entry?.id))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  private nextAvailableDescriptorPath(dir: string, baseId: string, extension: '.md' | '.json'): string {
    fs.mkdirSync(dir, { recursive: true });
    let index = 1;
    let candidate = validateWithinDir(path.join(dir, `${baseId}${extension}`), dir);
    while (fs.existsSync(candidate)) {
      index += 1;
      candidate = validateWithinDir(path.join(dir, `${baseId}-${index}${extension}`), dir);
    }
    return candidate;
  }

  private removeRetiredSkillJsonFiles(workspaceRoot: string): void {
    const dir = appPathService.getWorkspacePaths(workspaceRoot).skillsPath;
    if (!fs.existsSync(dir)) {
      return;
    }

    for (const entry of fs.readdirSync(dir)) {
      if (!entry.endsWith('.json')) {
        continue;
      }
      const filePath = path.join(dir, entry);
      const descriptor = readJsonFile<AgentRuntimeSkillDescriptor>(filePath);
      if (descriptor?.id && RETIRED_SKILL_JSON_IDS.has(descriptor.id)) {
        fs.unlinkSync(filePath);
      }
    }
  }
}

export const agentRuntimeConfigService = new AgentRuntimeConfigService();

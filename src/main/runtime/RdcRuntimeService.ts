import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import type { RdcRuntimeOverview, RestrictivePolicy, ScopedResourceDocument, ScopedResourceKind, ScopedResourceWriteRequest } from '@shared/types/rdcRuntime';
import { appPathService } from './AppPathService';
import { hashScopedResource, scopedResourceResolver } from './ScopedResourceResolver';
import { hookEngine } from '../hooks/HookEngine';
import { agentRuntimeConfigService } from '../settings/AgentRuntimeConfigService';
import { mcpTrustService } from '../settings/McpTrustService';

const EXTENSIONS: Partial<Record<ScopedResourceKind, string>> = {
  agent: '.agent.md', mcp: '.mcp.json', hook: '.hook.yml', policy: '.policy.yml', memory: '.md', knowledge: '.md',
};
const safeId = (value: string): string => {
  const id = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!id) throw new Error('Resource id is required.');
  return id;
};
const assertInside = (root: string, target: string): void => {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Resource path escaped its scope root.');
};

export class RdcRuntimeService {
  constructor(private readonly hooks = hookEngine) {}

  private rootFor(kind: ScopedResourceKind, scope: 'user' | 'project', projectRoot?: string): string {
    const user = appPathService.getUserRdcPaths();
    const project = scope === 'project' ? appPathService.getProjectRdcPaths(this.requireProject(projectRoot)) : undefined;
    const paths = scope === 'user' ? user : project!;
    const map: Partial<Record<ScopedResourceKind, string>> = {
      agent: paths.agentsPath, skill: paths.skillsPath, mcp: paths.mcpPath, hook: paths.hooksPath,
      policy: paths.policiesPath, knowledge: paths.knowledgePath, memory: paths.memoryPath,
    };
    const root = map[kind];
    if (!root) throw new Error(`Unsupported scoped resource kind: ${kind}`);
    return root;
  }

  list(projectRoot?: string): ScopedResourceDocument[] {
    const documents: ScopedResourceDocument[] = [];
    for (const scope of ['user', ...(projectRoot ? ['project'] : [])] as Array<'user' | 'project'>) {
      for (const kind of ['agent', 'skill', 'mcp', 'hook', 'policy'] as ScopedResourceKind[]) {
        const root = this.rootFor(kind, scope, projectRoot);
        if (!fs.existsSync(root)) continue;
        try {
          if (kind === 'skill') {
            for (const entry of fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
              const sourcePath = path.join(root, entry.name, 'SKILL.md');
              if (!fs.existsSync(sourcePath)) continue;
              documents.push(this.readDocumentSafe(kind, scope, entry.name, sourcePath));
            }
            continue;
          }
          const extension = EXTENSIONS[kind]!;
          for (const entry of fs.readdirSync(root).filter((entry) => entry.endsWith(extension)).sort()) {
            documents.push(this.readDocumentSafe(
              kind,
              scope,
              entry.slice(0, -extension.length),
              path.join(root, entry),
            ));
          }
        } catch (error) {
          documents.push({
            id: `_root_${kind}`,
            kind,
            scope,
            sourcePath: root,
            sourceHash: hashScopedResource(root),
            effectiveStatus: 'invalid',
            content: '',
            diagnostics: [
              `Failed to list ${kind} root: ${error instanceof Error ? error.message : String(error)}`,
            ],
          });
        }
      }
    }
    const byKey = new Map<string, ScopedResourceDocument[]>();
    for (const document of documents) {
      const key = `${document.kind}:${document.id}`;
      byKey.set(key, [...(byKey.get(key) ?? []), document]);
    }
    for (const variants of byKey.values()) {
      const project = variants.find((entry) => entry.scope === 'project');
      if (project) variants.filter((entry) => entry.scope === 'user').forEach((entry) => { entry.effectiveStatus = 'overridden'; });
    }
    return documents;
  }

  overview(projectRoot?: string): RdcRuntimeOverview {
    appPathService.initializeRuntime();
    if (projectRoot) appPathService.initializeProjectRdc(projectRoot);
    const user = appPathService.getUserRdcPaths();
    const project = projectRoot ? appPathService.getProjectRdcPaths(projectRoot) : undefined;
    const hooks = this.hooks.load(user.hooksPath, projectRoot).map((hook) => ({
      id: hook.definition.id,
      scope: hook.scope,
      sourcePath: hook.sourcePath,
      sourceHash: hook.sourceHash,
      enabled: hook.definition.enabled,
      event: hook.definition.event,
      trusted: hook.trust.trusted,
      needsRetrust: hook.trust.needsRetrust,
      trustFingerprint: hook.trustFingerprint,
      failurePolicy: hook.definition.failurePolicy,
    }));
    const mcpServers = agentRuntimeConfigService.listMcpServers(projectRoot).map((server) => ({
      id: server.id,
      name: server.name,
      scope: server.scope === 'project' ? 'project' as const : 'user' as const,
      ...(server.sourcePath ? { sourcePath: server.sourcePath } : {}),
      ...(server.descriptorHash ? { descriptorHash: server.descriptorHash } : {}),
      trusted: server.scope === 'project' ? !server.needsRetrust : true,
      needsRetrust: Boolean(server.needsRetrust),
      ...(server.executableOverrideRejected ? { executableOverrideRejected: true } : {}),
      ...(server.blockedReason ? { blockedReason: server.blockedReason } : {}),
      ...(server.command ? { command: server.command } : {}),
      transport: server.transport,
    }));
    const resources = this.list(projectRoot);
    const diagnostics: string[] = [];
    for (const resource of resources) {
      for (const diagnostic of resource.diagnostics) {
        diagnostics.push(`${resource.kind}/${resource.scope}/${resource.id}: ${diagnostic}`);
      }
    }
    for (const hook of hooks) {
      if (hook.scope !== 'builtin' && !hook.trusted) {
        diagnostics.push(`hook/${hook.scope}/${hook.id}: ${hook.scope} hook is not trusted`);
      }
    }
    for (const server of mcpServers) {
      if (server.blockedReason) {
        diagnostics.push(`mcp/${server.scope}/${server.id}: ${server.blockedReason}`);
      } else if (server.needsRetrust) {
        diagnostics.push(`mcp/project/${server.id}: project MCP needs trust before connect`);
      }
    }
    return {
      userRoot: user.userRdcRoot,
      ...(projectRoot ? { projectRoot } : {}),
      userPaths: { ...user },
      ...(project ? { projectPaths: { ...project } } : {}),
      resources, hooks, mcpServers,
      knowledge: { userPath: user.knowledgePath, ...(project ? { projectPath: project.knowledgePath } : {}) },
      memory: { userPath: user.memoryPath, ...(project ? { projectPath: project.memoryPath } : {}) },
      diagnostics,
    };
  }

  trustProjectMcp(projectRoot: string, descriptorId: string): RdcRuntimeOverview {
    const descriptor = agentRuntimeConfigService.listMcpServers(projectRoot).find((entry) => entry.id === descriptorId);
    if (!descriptor) {
      throw new Error(`MCP descriptor not found: ${descriptorId}`);
    }
    if (descriptor.executableOverrideRejected) {
      throw new Error(descriptor.blockedReason || `Project MCP "${descriptorId}" cannot override user executable fields.`);
    }
    if (descriptor.scope !== 'project') {
      throw new Error(`MCP "${descriptorId}" is not a project-scoped descriptor requiring trust.`);
    }
    const descriptorHash = descriptor.descriptorHash || '';
    if (!descriptorHash) {
      throw new Error(`MCP "${descriptorId}" is missing descriptorHash.`);
    }
    mcpTrustService.trust(projectRoot, descriptorId, descriptorHash);
    return this.overview(projectRoot);
  }

  revokeProjectMcp(projectRoot: string, descriptorId: string): RdcRuntimeOverview {
    mcpTrustService.revoke(projectRoot, descriptorId);
    return this.overview(projectRoot);
  }

  validate(request: ScopedResourceWriteRequest): string[] {
    const diagnostics: string[] = [];
    try {
      if (!request.content.trim()) throw new Error('Resource content is empty.');
      if (request.kind === 'mcp') JSON.parse(request.content);
      if (request.kind === 'agent' || request.kind === 'skill') {
        const frontmatter = request.content.match(/^---\r?\n([\s\S]*?)\r?\n---/u);
        if (request.kind === 'agent' && !frontmatter) throw new Error('Agent requires YAML frontmatter.');
        if (frontmatter) YAML.parse(frontmatter[1]);
      }
      if (request.kind === 'hook' || request.kind === 'policy') YAML.parse(request.content);
      if (request.kind === 'policy' && request.scope === 'project' && request.projectRoot) {
        const userPolicyPath = path.join(appPathService.getUserRdcPaths().policiesPath, `${safeId(request.id)}.policy.yml`);
        if (fs.existsSync(userPolicyPath)) {
          const base = YAML.parse(fs.readFileSync(userPolicyPath, 'utf8')) as RestrictivePolicy;
          scopedResourceResolver.tightenPolicy(base, YAML.parse(request.content) as RestrictivePolicy);
        }
      }
    } catch (error) { diagnostics.push(error instanceof Error ? error.message : String(error)); }
    return diagnostics;
  }

  upsert(request: ScopedResourceWriteRequest): ScopedResourceDocument {
    const diagnostics = this.validate(request);
    if (diagnostics.length) throw new Error(diagnostics.join('\n'));
    const id = safeId(request.id);
    const root = this.rootFor(request.kind, request.scope, request.projectRoot);
    const sourcePath = request.kind === 'skill' ? path.join(root, id, 'SKILL.md') : path.join(root, `${id}${EXTENSIONS[request.kind]}`);
    assertInside(root, sourcePath);
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.writeFileSync(sourcePath, `${request.content.trim()}\n`, 'utf8');
    return this.readDocument(request.kind, request.scope, id, sourcePath);
  }

  importFromFile(request: { kind: ScopedResourceKind; scope: 'user' | 'project'; filePath: string; projectRoot?: string }): ScopedResourceDocument {
    const filePath = path.resolve(request.filePath);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      throw new Error('Import source file was not found.');
    }
    const basename = path.basename(filePath);
    const lower = basename.toLowerCase();
    const allowed = (() => {
      if (request.kind === 'skill') return lower.endsWith('.md');
      if (request.kind === 'mcp') return lower.endsWith('.json');
      if (request.kind === 'hook' || request.kind === 'policy') return lower.endsWith('.yml') || lower.endsWith('.yaml');
      if (request.kind === 'agent') return lower.endsWith('.agent.md') || lower.endsWith('.md');
      return false;
    })();
    if (!allowed) throw new Error(`Unsupported file type for ${request.kind} import.`);
    const content = fs.readFileSync(filePath, 'utf8');
    let id = path.basename(filePath, path.extname(filePath));
    if (request.kind === 'skill' && lower === 'skill.md') id = path.basename(path.dirname(filePath));
    if (request.kind === 'agent' && lower.endsWith('.agent.md')) id = basename.slice(0, -'.agent.md'.length);
    try {
      if (request.kind === 'mcp') {
        const parsed = JSON.parse(content) as { id?: string };
        if (parsed.id) id = String(parsed.id);
      } else if (request.kind === 'hook' || request.kind === 'policy') {
        const parsed = YAML.parse(content) as { id?: string };
        if (parsed?.id) id = String(parsed.id);
      }
    } catch {
      // keep filename-derived id
    }
    return this.upsert({
      kind: request.kind,
      scope: request.scope,
      id,
      content,
      ...(request.projectRoot ? { projectRoot: request.projectRoot } : {}),
    });
  }

  delete(kind: ScopedResourceKind, scope: 'user' | 'project', idValue: string, projectRoot?: string): void {
    const id = safeId(idValue);
    if (kind === 'hook' && scope === 'project') this.hooks.revokeProjectHook(this.requireProject(projectRoot), id);
    if (kind === 'hook' && scope === 'user') this.hooks.revokeUserHook(id);
    const root = this.rootFor(kind, scope, projectRoot);
    const target = kind === 'skill' ? path.join(root, id) : path.join(root, `${id}${EXTENSIONS[kind]}`);
    assertInside(root, target);
    fs.rmSync(target, { recursive: kind === 'skill', force: true });
  }

  private readDocumentSafe(
    kind: ScopedResourceKind,
    scope: 'user' | 'project',
    id: string,
    sourcePath: string,
  ): ScopedResourceDocument {
    try {
      return this.readDocument(kind, scope, id, sourcePath);
    } catch (error) {
      return {
        id,
        kind,
        scope,
        sourcePath,
        sourceHash: hashScopedResource(`unreadable:${sourcePath}`),
        effectiveStatus: 'invalid',
        content: '',
        diagnostics: [
          `Failed to read ${kind}/${id}: ${error instanceof Error ? error.message : String(error)}`,
        ],
      };
    }
  }

  private readDocument(kind: ScopedResourceKind, scope: 'user' | 'project', id: string, sourcePath: string): ScopedResourceDocument {
    const content = fs.readFileSync(sourcePath, 'utf8');
    const diagnostics = this.validate({ kind, scope, id, content });
    let enabled = true;
    try {
      if (kind === 'agent') enabled = YAML.parse(content.match(/^---\r?\n([\s\S]*?)\r?\n---/u)?.[1] ?? '').enabled !== false;
      else if (kind === 'mcp') enabled = JSON.parse(content).enabledByDefault !== false;
      else if (kind === 'hook' || kind === 'policy') enabled = YAML.parse(content).enabled !== false;
    } catch { enabled = false; }
    return { id, kind, scope, sourcePath, sourceHash: hashScopedResource(content), effectiveStatus: diagnostics.length ? 'invalid' : enabled ? 'effective' : 'disabled', content, diagnostics };
  }

  private requireProject(projectRoot?: string): string {
    if (!projectRoot) throw new Error('Project scope requires an active project root.');
    return projectRoot;
  }
}

export const rdcRuntimeService = new RdcRuntimeService();

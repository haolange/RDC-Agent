import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import type {
  AgentRuntimeMcpDescriptor,
  AgentRuntimeSkillDescriptor,
} from '@shared/types/agentRuntime';
import { MCP_TRANSPORTS as MCP_TRANSPORT_LIST, type MCPTransport } from '@shared/types/mcp';
import type { ScopedResourceCandidate, SkillLoadResult, SkillMetadata } from '@shared/types/rdcRuntime';
import { appPathService } from '../runtime/AppPathService';
import { scopedResourceResolver } from '../runtime/ScopedResourceResolver';
import {
  mcpDescriptorHash,
  mcpTrustService,
  projectOverridesUserExecutable,
} from './McpTrustService';
import { isSkillVisibleToProfile } from '@shared/constants/canonicalSkills';

const MCP_TRANSPORTS = new Set<MCPTransport>(MCP_TRANSPORT_LIST);

const toRuntimeId = (value: string, fallback = 'custom'): string =>
  value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || fallback;

const readJsonFile = <T>(filePath: string): T | null => {
  try {
    return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) as T : null;
  } catch {
    return null;
  }
};

const parseSkill = (skillDir: string, scope: 'builtin' | 'user' | 'project'): SkillLoadResult | null => {
  const sourcePath = path.join(skillDir, 'SKILL.md');
  if (!fs.existsSync(sourcePath)) return null;
  const raw = fs.readFileSync(sourcePath, 'utf8').replace(/^\uFEFF/u, '');
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u.exec(raw);
  const frontmatter = match ? YAML.parse(match[1]) as Record<string, unknown> : {};
  const id = toRuntimeId(path.basename(skillDir), 'skill');
  const name = typeof frontmatter.name === 'string' && frontmatter.name.trim() ? frontmatter.name.trim() : id;
  const description = typeof frontmatter.description === 'string' ? frontmatter.description.trim() : '';
  const allowedTools = Array.isArray(frontmatter['allowed-tools'])
    ? frontmatter['allowed-tools'].filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.trim()).filter(Boolean)
    : [];
  const instructions = (match ? match[2] : raw).trim();
  return {
    id,
    name,
    description,
    allowedTools,
    scope,
    sourcePath,
    sourceHash: '',
    effectiveStatus: 'effective',
    instructions,
    ...(fs.existsSync(path.join(skillDir, 'references')) ? { referencesPath: path.join(skillDir, 'references') } : {}),
    ...(fs.existsSync(path.join(skillDir, 'scripts')) ? { scriptsPath: path.join(skillDir, 'scripts') } : {}),
    ...(fs.existsSync(path.join(skillDir, 'assets')) ? { assetsPath: path.join(skillDir, 'assets') } : {}),
  };
};

export class AgentRuntimeConfigService {
  private templateRoot(): string {
    return appPathService.getBuiltinAgentRuntimeRoot();
  }

  ensureScaffold(): void {
    appPathService.initializeRuntime();
  }

  listSkills(projectRoot?: string, viewerAgentId?: string): AgentRuntimeSkillDescriptor[] {
    return this.resolveSkills(projectRoot, viewerAgentId).map((skill) => ({
      id: skill.id,
      name: skill.name,
      label: skill.name,
      description: skill.description,
      source: skill.scope,
      enabledByDefault: true,
      path: skill.sourcePath,
      parameters: {
        allowedTools: skill.allowedTools,
        effectiveStatus: skill.effectiveStatus,
        sourceHash: skill.sourceHash,
      },
    }));
  }

  listSkillMetadata(projectRoot?: string, viewerAgentId?: string): SkillMetadata[] {
    return this.resolveSkills(projectRoot, viewerAgentId).map(({ instructions: _instructions, referencesPath: _references, scriptsPath: _scripts, assetsPath: _assets, ...metadata }) => metadata);
  }

  loadSkill(id: string, projectRoot?: string, viewerAgentId?: string): SkillLoadResult | null {
    return this.resolveSkills(projectRoot, viewerAgentId).find((skill) => skill.id === toRuntimeId(id, 'skill')) ?? null;
  }

  private resolveSkills(projectRoot?: string, viewerAgentId?: string): SkillLoadResult[] {
    this.ensureScaffold();
    const user = appPathService.getUserRdcPaths();
    const candidates: Array<ScopedResourceCandidate<SkillLoadResult>> = [];
    const addDirectory = (root: string, scope: 'builtin' | 'user' | 'project') => {
      if (!fs.existsSync(root)) return;
      fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).forEach((entry) => {
        const loaded = parseSkill(path.join(root, entry.name), scope);
        if (loaded) candidates.push({ id: loaded.id, kind: 'skill', scope, sourcePath: loaded.sourcePath, value: loaded });
      });
    };
    addDirectory(path.join(this.templateRoot(), 'skills'), 'builtin');
    addDirectory(user.skillsPath, 'user');
    if (projectRoot) addDirectory(appPathService.getProjectRdcPaths(projectRoot).skillsPath, 'project');
    const resolved = scopedResourceResolver.resolve(candidates).resources.filter((resource) => resource.enabled).map((resource) => ({
      ...resource.value,
      scope: resource.provenance.scope,
      sourcePath: resource.provenance.sourcePath,
      sourceHash: resource.provenance.sourceHash,
      effectiveStatus: resource.effectiveStatus,
    }));
    if (!viewerAgentId) return resolved;
    return resolved.filter((skill) => isSkillVisibleToProfile(viewerAgentId, skill.id));
  }

  listMcpServers(projectRoot?: string): AgentRuntimeMcpDescriptor[] {
    this.ensureScaffold();
    const userDescriptors = new Map<string, AgentRuntimeMcpDescriptor>();
    const projectDescriptors = new Map<string, AgentRuntimeMcpDescriptor>();

    const loadDirectory = (
      root: string,
      scope: 'user' | 'project',
      target: Map<string, AgentRuntimeMcpDescriptor>,
    ) => {
      if (!fs.existsSync(root)) return;
      fs.readdirSync(root).filter((entry) => entry.endsWith('.mcp.json')).forEach((entry) => {
        const sourcePath = path.join(root, entry);
        const value = readJsonFile<AgentRuntimeMcpDescriptor & { transport?: string }>(sourcePath);
        if (!value?.id) return;
        if (!MCP_TRANSPORTS.has(value.transport as MCPTransport)) {
          const transportLabel = typeof value.transport === 'string' ? value.transport : String(value.transport);
          target.set(value.id, {
            ...value,
            transport: value.transport as MCPTransport,
            scope,
            sourcePath,
            enabledByDefault: false,
            blockedReason: 'MCP_TRANSPORT_UNSUPPORTED: ' + transportLabel,
          });
          return;
        }
        target.set(value.id, {
          ...value,
          scope,
          sourcePath,
          enabledByDefault: value.enabledByDefault !== false,
        });
      });
    };

    loadDirectory(appPathService.getUserRdcPaths().mcpPath, 'user', userDescriptors);
    if (projectRoot) {
      loadDirectory(appPathService.getProjectRdcPaths(projectRoot).mcpPath, 'project', projectDescriptors);
    }

    const ids = new Set([...userDescriptors.keys(), ...projectDescriptors.keys()]);
    const resolved: AgentRuntimeMcpDescriptor[] = [];

    const withMcpTrustMetadata = (descriptor: AgentRuntimeMcpDescriptor): AgentRuntimeMcpDescriptor => {
      const descriptorHash = mcpDescriptorHash(descriptor);
      if (descriptor.scope !== 'project' || !projectRoot) {
        return { ...descriptor, descriptorHash, needsRetrust: false };
      }
      const projectRealpath = mcpTrustService.resolveProjectRealpath(projectRoot);
      const trusted = mcpTrustService.isTrusted(projectRealpath, descriptor.id, descriptorHash);
      return {
        ...descriptor,
        descriptorHash,
        projectRealpath,
        needsRetrust: !trusted,
        ...(trusted ? {} : {
          blockedReason: `Project MCP "${descriptor.id}" needs trust for projectRealpath+descriptorHash before connect.`,
        }),
      };
    };

    for (const id of Array.from(ids).sort()) {
      const user = userDescriptors.get(id);
      const project = projectDescriptors.get(id);

      if (user && project) {
        if (projectOverridesUserExecutable(user, project)) {
          resolved.push(withMcpTrustMetadata({
            ...user,
            scope: 'user',
            sourcePath: user.sourcePath,
            sourceHash: mcpDescriptorHash(user),
            executableOverrideRejected: true,
            blockedReason: `Project MCP "${id}" cannot override user command/args/url/env.`,
            enabledByDefault: project.enabledByDefault === false ? false : user.enabledByDefault,
          }));
          continue;
        }
        resolved.push(withMcpTrustMetadata({
          ...user,
          name: project.name || user.name,
          description: project.description ?? user.description,
          enabledByDefault: project.enabledByDefault,
          scope: 'user',
          sourcePath: user.sourcePath,
          sourceHash: mcpDescriptorHash(user),
        }));
        continue;
      }

      if (project) {
        const descriptorHash = mcpDescriptorHash(project);
        resolved.push(withMcpTrustMetadata({
          ...project,
          scope: 'project',
          sourceHash: descriptorHash,
          descriptorHash,
        }));
        continue;
      }

      if (user) {
        resolved.push(withMcpTrustMetadata({
          ...user,
          scope: 'user',
          sourceHash: mcpDescriptorHash(user),
        }));
      }
    }

    return resolved;
  }

}

export const agentRuntimeConfigService = new AgentRuntimeConfigService();

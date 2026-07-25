import fs from 'fs';
import path from 'path';
import type { AgentRuntimeMcpDescriptor } from '@shared/types/agentRuntime';
import { appPathService } from '../runtime/AppPathService';
import { hashScopedResource } from '../runtime/ScopedResourceResolver';

export interface McpTrustRecord {
  projectRealpath: string;
  descriptorId: string;
  descriptorHash: string;
  trustedAt: string;
}

type McpTrustStore = Record<string, McpTrustRecord>;

export function mcpExecutableFingerprint(descriptor: Pick<AgentRuntimeMcpDescriptor, 'command' | 'args' | 'url' | 'env'>): string {
  return hashScopedResource({
    command: descriptor.command ?? '',
    args: descriptor.args ?? [],
    url: descriptor.url ?? '',
    env: descriptor.env ?? {},
  });
}

export function mcpDescriptorHash(descriptor: AgentRuntimeMcpDescriptor): string {
  return hashScopedResource({
    id: descriptor.id,
    transport: descriptor.transport,
    command: descriptor.command,
    args: descriptor.args ?? [],
    url: descriptor.url,
    env: descriptor.env ?? {},
  });
}

export function projectOverridesUserExecutable(
  user: AgentRuntimeMcpDescriptor,
  project: AgentRuntimeMcpDescriptor,
): boolean {
  return mcpExecutableFingerprint(user) !== mcpExecutableFingerprint(project);
}

export class McpTrustService {
  constructor(
    private readonly trustStorePath = path.join(appPathService.getAppStatePaths().appStateRoot, 'mcp-trust.json'),
  ) {}

  resolveProjectRealpath(projectRoot: string): string {
    try {
      return fs.realpathSync.native(path.resolve(projectRoot));
    } catch {
      return path.resolve(projectRoot);
    }
  }

  isTrusted(projectRoot: string, descriptorId: string, descriptorHash: string): boolean {
    const projectRealpath = this.resolveProjectRealpath(projectRoot);
    const record = this.readStore()[this.trustKey(projectRealpath, descriptorId)];
    return Boolean(record
      && record.projectRealpath === projectRealpath
      && record.descriptorHash === descriptorHash);
  }

  trust(projectRoot: string, descriptorId: string, descriptorHash: string): McpTrustRecord {
    const projectRealpath = this.resolveProjectRealpath(projectRoot);
    const trustedAt = new Date().toISOString();
    const store = this.readStore();
    const record: McpTrustRecord = {
      projectRealpath,
      descriptorId,
      descriptorHash,
      trustedAt,
    };
    store[this.trustKey(projectRealpath, descriptorId)] = record;
    this.writeStore(store);
    return record;
  }

  revoke(projectRoot: string, descriptorId: string): void {
    const projectRealpath = this.resolveProjectRealpath(projectRoot);
    const store = this.readStore();
    delete store[this.trustKey(projectRealpath, descriptorId)];
    this.writeStore(store);
  }

  assertConnectAllowed(descriptor: AgentRuntimeMcpDescriptor, projectRoot?: string | null): void {
    // executableOverrideRejected means the project command was discarded and the
    // retained user executable may still connect.
    if (descriptor.scope !== 'project') {
      return;
    }
    if (!projectRoot) {
      throw new Error(`Project MCP "${descriptor.id}" requires a trusted project root before connect.`);
    }
    const projectRealpath = this.resolveProjectRealpath(projectRoot);
    const descriptorHash = descriptor.descriptorHash || mcpDescriptorHash(descriptor);
    if (!this.isTrusted(projectRealpath, descriptor.id, descriptorHash)) {
      throw new Error(
        descriptor.blockedReason
          || `Project MCP "${descriptor.id}" needs trust for projectRealpath+descriptorHash before connect.`,
      );
    }
  }

  private trustKey(projectRealpath: string, descriptorId: string): string {
    return `${projectRealpath.toLowerCase()}::${descriptorId}`;
  }

  private readStore(): McpTrustStore {
    try {
      if (!fs.existsSync(this.trustStorePath)) {
        return {};
      }
      return JSON.parse(fs.readFileSync(this.trustStorePath, 'utf8')) as McpTrustStore;
    } catch {
      return {};
    }
  }

  private writeStore(store: McpTrustStore): void {
    fs.mkdirSync(path.dirname(this.trustStorePath), { recursive: true });
    fs.writeFileSync(this.trustStorePath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  }
}

export const mcpTrustService = new McpTrustService();

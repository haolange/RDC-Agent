import path from 'path';
import { argumentFileIdentities, canonicalRealpath, commandIdentity } from '../../runtime/fileIdentity';
import { hashScopedResource } from '../../runtime/ScopedResourceResolver';
import { ProjectTrustStore, type ProjectTrustRecord } from './ProjectTrustStore';
import type { AgentRuntimeMcpDescriptor } from '@shared/types/agentRuntime';

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

/**
 * What trusting a project MCP server binds to, matching hook trust: the descriptor, where it was
 * declared, the executable the command resolves to and the bytes of every file its arguments name.
 * Editing the launched script or swapping the binary on PATH asks for trust again.
 */
export function mcpTrustFingerprint(descriptor: AgentRuntimeMcpDescriptor, projectRealpath: string): string {
  return hashScopedResource({
    kind: 'mcp-trust-fingerprint',
    descriptor: mcpDescriptorHash(descriptor),
    sourcePath: descriptor.sourcePath ? canonicalRealpath(descriptor.sourcePath) : null,
    executable: descriptor.command ? commandIdentity(descriptor.command) : null,
    files: argumentFileIdentities(descriptor.args ?? [], (argument) => path.resolve(projectRealpath, argument)),
  });
}

export function projectOverridesUserExecutable(
  user: AgentRuntimeMcpDescriptor,
  project: AgentRuntimeMcpDescriptor,
): boolean {
  return mcpExecutableFingerprint(user) !== mcpExecutableFingerprint(project);
}

export function mcpUntrustedReason(descriptorId: string): string {
  return `MCP_TRUST_REQUIRED: project MCP "${descriptorId}" is not trusted, or its command or files changed since it was trusted.`;
}

export class McpTrustService {
  private readonly store: ProjectTrustStore;

  constructor(explicitTrustStorePath?: string) {
    this.store = new ProjectTrustStore('mcp-trust.json', explicitTrustStorePath);
  }

  resolveProjectRealpath(projectRoot: string): string {
    return this.store.resolveProjectRealpath(projectRoot);
  }

  isTrusted(projectRoot: string, descriptor: AgentRuntimeMcpDescriptor): boolean {
    const projectRealpath = this.resolveProjectRealpath(projectRoot);
    return this.store.isTrusted(projectRealpath, descriptor.id, mcpTrustFingerprint(descriptor, projectRealpath));
  }

  trust(projectRoot: string, descriptor: AgentRuntimeMcpDescriptor): ProjectTrustRecord {
    const projectRealpath = this.resolveProjectRealpath(projectRoot);
    return this.store.trust(projectRealpath, descriptor.id, mcpTrustFingerprint(descriptor, projectRealpath));
  }

  revoke(projectRoot: string, descriptorId: string): void {
    this.store.revoke(projectRoot, descriptorId);
  }

  assertConnectAllowed(descriptor: AgentRuntimeMcpDescriptor, projectRoot?: string | null): void {
    if (descriptor.blockedReason && descriptor.blockedReason.startsWith('MCP_TRANSPORT_UNSUPPORTED:')) {
      throw new Error(descriptor.blockedReason);
    }
    // executableOverrideRejected means the project command was discarded and the
    // retained user executable may still connect.
    if (descriptor.scope !== 'project') {
      return;
    }
    // Re-fingerprint at connect time: the script may have changed since the settings snapshot.
    if (!projectRoot || !this.isTrusted(projectRoot, descriptor)) {
      throw new Error(mcpUntrustedReason(descriptor.id));
    }
  }
}

export const mcpTrustService = new McpTrustService();

/**
 * McpConnectionCoordinator — MCP 连接池按 projectRoot + descriptorHash 分组。
 *
 * 仅 eviction 失配连接；不因 projectRoot 变化 disconnectAll()。
 */

import { createHash } from 'crypto';
import * as path from 'path';
import type { AgentRole } from '@shared/types/agent';
import type { AgentRuntimeMcpDescriptor } from '@shared/types/agentRuntime';
import type { MCPServerStatusSummary } from '@shared/types/mcp';
import { MCPManager, type MCPServerConfig } from '../../agent-runtime/agent/MCPManager';
import type { AgentTool } from '../../agent-runtime/agent/AgentTool';
import { agentRuntimeConfigService } from '../../settings/AgentRuntimeConfigService';
import { mcpTrustService } from '../../settings/McpTrustService';

interface ProjectMcpPool {
  key: string;
  projectRootPath: string | null;
  descriptorHash: string;
  manager: MCPManager;
  connecting: Map<string, Promise<void>>;
  failedMcpServers: Map<string, string>;
  lastUsedAt: number;
  activeTurnRefs: number;
  closing: boolean;
  superseded: boolean;
}

export interface McpConnectionLease {
  readonly poolKey: string;
  readonly projectRootPath: string | null;
  readonly descriptorHash: string;
  release(options?: { discardIfIdle?: boolean }): Promise<void>;
}

export interface AcquiredMcpConnections {
  errors: string[];
  lease: McpConnectionLease | null;
}

export class McpConnectionCoordinator {
  private readonly pools = new Map<string, ProjectMcpPool>();
  private readonly activePoolByProject = new Map<string, string>();

  getAgentTools(projectRootPath?: string | null, poolKey?: string | null): AgentTool[] {
    const pool = poolKey
      ? this.pools.get(poolKey)
      : this.resolveActivePool(projectRootPath);
    if (!pool || pool.closing) return [];
    if (poolKey && projectRootPath && pool.projectRootPath && this.projectKey(pool.projectRootPath) !== this.projectKey(projectRootPath)) {
      return [];
    }
    return pool.manager.getAgentTools();
  }

  getRuntimeStatusSummary(projectRootPath?: string | null): MCPServerStatusSummary[] {
    return this.resolveActivePool(projectRootPath)?.manager.getServerStatusSummary() ?? [];
  }

  /** Settings / IPC status is scoped to the requested project and never merges pools. */
  getMcpServerStatusSummary(projectRootPath?: string | null, query?: string): MCPServerStatusSummary[] {
    const normalizedQuery = query?.trim().toLowerCase() ?? '';
    const configured = agentRuntimeConfigService.listMcpServers(projectRootPath ?? undefined)
      .filter((server) => !normalizedQuery
        || (server.id + ' ' + server.name + ' ' + server.description).toLowerCase().includes(normalizedQuery));
    const runtimeById = new Map(
      this.getRuntimeStatusSummary(projectRootPath).map((entry) => [entry.id, entry]),
    );
    return configured.map((server) => {
      const runtime = runtimeById.get(server.id) ?? runtimeById.get(server.name);
      const summary: MCPServerStatusSummary = {
        id: server.id,
        name: server.name,
        connectionStatus: runtime?.connectionStatus ?? 'unknown',
        toolCount: runtime?.toolCount ?? 0,
        tools: runtime?.tools ?? [],
      };
      if (runtime?.lastError) summary.lastError = runtime.lastError;
      return summary;
    });
  }

  async disconnectAll(): Promise<void> {
    const pools = Array.from(this.pools.values());
    for (const pool of pools) pool.closing = true;
    await Promise.all(pools.map(async (pool) => {
      await Promise.allSettled(pool.connecting.values());
      await pool.manager.disconnectAll();
    }));
    this.pools.clear();
    this.activePoolByProject.clear();
  }

  async acquireConnections(
    agentId: AgentRole,
    projectRootPath?: string | null,
    enabledMcpIds?: readonly string[],
  ): Promise<AcquiredMcpConnections> {
    const descriptors = this.getEnabledMcpDescriptors(agentId, projectRootPath, enabledMcpIds);
    if (descriptors.length === 0) {
      if (projectRootPath) this.activePoolByProject.delete(this.projectKey(projectRootPath));
      return { errors: [], lease: null };
    }
    const root = projectRootPath ? path.resolve(projectRootPath) : null;
    const descriptorHash = this.descriptorSetHash(descriptors);
    const poolKey = this.poolKey(root, descriptorHash);
    let pool = this.pools.get(poolKey);
    if (!pool) {
      pool = {
        key: poolKey,
        projectRootPath: root,
        descriptorHash,
        manager: new MCPManager(),
        connecting: new Map(),
        failedMcpServers: new Map(),
        lastUsedAt: Date.now(),
        activeTurnRefs: 0,
        closing: false,
        superseded: false,
      };
      this.pools.set(poolKey, pool);
    }
    if (pool.closing) {
      throw new Error(`MCP pool ${poolKey} is closing; retry the turn preparation.`);
    }
    pool.activeTurnRefs += 1;
    pool.lastUsedAt = Date.now();
    if (root) {
      const rootKey = this.projectKey(root);
      this.activePoolByProject.set(rootKey, poolKey);
      for (const candidate of this.pools.values()) {
        if (candidate.key !== poolKey && candidate.projectRootPath && this.projectKey(candidate.projectRootPath) === rootKey) {
          candidate.superseded = true;
        }
      }
    }
    const errors: string[] = [];
    for (const descriptor of descriptors) {
      if (pool.manager.listServers().includes(descriptor.id)) continue;
      const previousError = pool.failedMcpServers.get(descriptor.id);
      if (previousError) {
        errors.push(descriptor.id + ': ' + previousError);
        continue;
      }
      try {
        await this.ensurePoolServerConnected(pool, descriptor, projectRootPath);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        pool.failedMcpServers.set(descriptor.id, message);
        errors.push(descriptor.id + ': ' + message);
      }
    }
    let released = false;
    const lease: McpConnectionLease = {
      poolKey,
      projectRootPath: root,
      descriptorHash,
      release: async (options = {}) => {
        if (released) return;
        released = true;
        await this.releasePool(poolKey, options.discardIfIdle === true);
      },
    };
    return { errors, lease };
  }

  private async releasePool(poolKey: string, discardIfIdle: boolean): Promise<void> {
    const pool = this.pools.get(poolKey);
    if (!pool) return;
    pool.activeTurnRefs = Math.max(0, pool.activeTurnRefs - 1);
    pool.lastUsedAt = Date.now();
    if (pool.activeTurnRefs > 0) return;
    if (!discardIfIdle && !pool.superseded) return;
    const projectKey = pool.projectRootPath ? this.projectKey(pool.projectRootPath) : null;
    if (projectKey && this.activePoolByProject.get(projectKey) === poolKey) {
      this.activePoolByProject.delete(projectKey);
    }
    await this.evictPool(pool);
  }

  private async ensurePoolServerConnected(
    pool: ProjectMcpPool,
    descriptor: AgentRuntimeMcpDescriptor,
    projectRootPath?: string | null,
  ): Promise<void> {
    if (pool.manager.listServers().includes(descriptor.id)) return;
    if (pool.closing) throw new Error('MCP pool ' + pool.key + ' is closing.');
    const existing = pool.connecting.get(descriptor.id);
    if (existing) return existing;
    const pending = (async () => {
      mcpTrustService.assertConnectAllowed(descriptor, projectRootPath);
      await pool.manager.connect(this.toMcpServerConfig(descriptor));
    })();
    pool.connecting.set(descriptor.id, pending);
    try {
      await pending;
    } finally {
      if (pool.connecting.get(descriptor.id) === pending) pool.connecting.delete(descriptor.id);
    }
  }
  private async evictPool(pool: ProjectMcpPool): Promise<void> {
    if (pool.closing || pool.activeTurnRefs > 0) return;
    pool.closing = true;
    try {
      await Promise.allSettled(pool.connecting.values());
      await pool.manager.disconnectAll();
    } finally {
      if (this.pools.get(pool.key) === pool) this.pools.delete(pool.key);
      const projectKey = pool.projectRootPath ? this.projectKey(pool.projectRootPath) : null;
      if (projectKey && this.activePoolByProject.get(projectKey) === pool.key) {
        this.activePoolByProject.delete(projectKey);
      }
    }
  }

  private resolveActivePool(projectRootPath?: string | null): ProjectMcpPool | undefined {
    const key = projectRootPath ? this.activePoolByProject.get(this.projectKey(projectRootPath)) : undefined;
    if (key) return this.pools.get(key);
    if (!projectRootPath && this.pools.size === 1) return this.pools.values().next().value;
    return undefined;
  }

  private projectKey(projectRootPath: string): string {
    return path.resolve(projectRootPath).toLowerCase();
  }

  private poolKey(projectRootPath: string | null, descriptorHash: string): string {
    return (projectRootPath ? this.projectKey(projectRootPath) : '<user>') + ':' + descriptorHash;
  }

  private descriptorSetHash(descriptors: readonly AgentRuntimeMcpDescriptor[]): string {
    return createHash('sha256')
      .update(JSON.stringify(descriptors.map((descriptor) => this.hashMcpDescriptor(descriptor)).sort()))
      .digest('hex')
      .slice(0, 24);
  }

  private hashMcpDescriptor(descriptor: AgentRuntimeMcpDescriptor): string {
    return createHash('sha256')
      .update(JSON.stringify({
        id: descriptor.id,
        transport: descriptor.transport,
        command: descriptor.command ?? null,
        args: descriptor.args ?? [],
        url: descriptor.url ?? null,
        env: descriptor.env ?? {},
      }))
      .digest('hex')
      .slice(0, 16);
  }

  private getEnabledMcpDescriptors(
    _agentId: AgentRole,
    projectRootPath?: string | null,
    enabledMcpIds?: readonly string[],
  ): AgentRuntimeMcpDescriptor[] {
    // The caller must provide the frozen effective profile surface. An
    // omitted list means that this turn has no enabled MCP servers; falling
    // back to user settings would reintroduce prompt/runtime split-brain.
    const ids = enabledMcpIds ?? [];
    const enabledIds = new Set(ids);
    return agentRuntimeConfigService.listMcpServers(projectRootPath ?? undefined)
      .filter((server) => enabledIds.has(server.id) || enabledIds.has(server.name));
  }

  private toMcpServerConfig(descriptor: AgentRuntimeMcpDescriptor): MCPServerConfig {
    return {
      name: descriptor.id,
      type: descriptor.transport,
      command: descriptor.command,
      args: descriptor.args,
      url: descriptor.url,
      env: descriptor.env,
    };
  }
}

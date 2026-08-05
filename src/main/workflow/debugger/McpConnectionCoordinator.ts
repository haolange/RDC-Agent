/**
 * McpConnectionCoordinator - MCP connection pools keyed by projectRoot + projectId + descriptorHash.
 *
 * Only eviction disconnects mismatched pools; projectRoot changes do not call disconnectAll().
 */

import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { AgentRole } from '@shared/types/agent';
import type { AgentRuntimeMcpDescriptor } from '@shared/types/agentRuntime';
import type { MCPServerStatusSummary } from '@shared/types/mcp';
import {
  MCPManager,
  type MCPServerConfig,
  type McpDisconnectDetail,
  type McpDisconnectStatus,
} from '../../agent-runtime/agent/MCPManager';
import type { AgentTool } from '../../agent-runtime/agent/AgentTool';
import type { SupervisedProcess } from '../../runtime/ProcessSupervisor';
import { agentRuntimeConfigService } from '../../settings/AgentRuntimeConfigService';
import { mcpTrustService } from '../../settings/McpTrustService';
import { runtimeLogService } from '../../runtime/RuntimeLogService';

const MCP_MAX_RETRYABLE_ATTEMPTS = 5;
const MCP_RETRY_BASE_MS = 2_000;
const MCP_RETRY_CAP_MS = 60_000;
const MCP_ORPHAN_DEADLINE_MS = 30_000;

export type McpFailureKind = 'retryable' | 'permanent';

export type McpFailureRecord = {
  kind: McpFailureKind;
  attempts: number;
  nextRetryAt: number;
  lastError: string;
};

interface ProjectMcpPool {
  key: string;
  projectRootPath: string | null;
  projectId: string | null;
  descriptorHash: string;
  manager: MCPManager;
  connecting: Map<string, Promise<void>>;
  failedMcpServers: Map<string, McpFailureRecord>;
  lastUsedAt: number;
  activeTurnRefs: number;
  closing: boolean;
  superseded: boolean;
  quarantined: boolean;
}

interface OrphanedPoolRecord {
  poolKey: string;
  projectRootPath: string | null;
  projectId: string | null;
  descriptorHash: string;
  supervised: SupervisedProcess[];
  quarantinedAt: number;
  deadlineTimer: ReturnType<typeof setTimeout> | null;
  released: boolean;
}

export interface McpConnectionLease {
  readonly poolKey: string;
  readonly projectRootPath: string | null;
  readonly projectId: string | null;
  readonly descriptorHash: string;
  release(options?: { discardIfIdle?: boolean }): Promise<void>;
}

export interface AcquiredMcpConnections {
  errors: string[];
  lease: McpConnectionLease | null;
}

export function canonicalMcpProjectRoot(projectRootPath: string, platform = process.platform): string {
  const resolved = path.resolve(projectRootPath);
  let real: string;
  try {
    real = fs.realpathSync.native(resolved);
  } catch {
    real = resolved;
  }
  return platform === 'win32' ? real.toLowerCase() : real;
}

export function classifyMcpFailure(err: unknown): McpFailureKind {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  if (
    message.includes('MCP_TRANSPORT_UNSUPPORTED')
    || /needs trust/i.test(message)
    || /trust denied|not trusted|requires a trusted project root/i.test(message)
    || /invalid descriptor|missing command|missing url/i.test(message)
    || /configuration error|misconfigured|blockedreason/i.test(lower)
    || /executableoverriderejected/i.test(lower)
  ) {
    return 'permanent';
  }
  if (
    /econnrefused|etimedout|enotfound|econnreset|eai_again|ehostunreach|enetunreach/i.test(message)
    || /timeout|timed out|spawn|network|temporarily unavailable|eperm|eacces|pipe|broken pipe/i.test(lower)
    || /unconfirmed orphan|failed to spawn/i.test(lower)
  ) {
    return 'retryable';
  }
  // Default retryable for transient connect/runtime failures; permanent only when clearly config/trust.
  return 'retryable';
}

function computeNextRetryAt(attempts: number, now = Date.now()): number {
  const exp = Math.max(0, attempts - 1);
  const delay = Math.min(MCP_RETRY_CAP_MS, MCP_RETRY_BASE_MS * (2 ** exp));
  return now + delay;
}

export class McpConnectionCoordinator {
  private readonly pools = new Map<string, ProjectMcpPool>();
  /** Maps `${rootKey}::${projectId}` → active poolKey. */
  private readonly activePoolByProject = new Map<string, string>();
  private readonly orphanedPools = new Map<string, OrphanedPoolRecord>();

  getAgentTools(projectRootPath?: string | null, poolKey?: string | null, projectId?: string | null): AgentTool[] {
    const pool = poolKey
      ? this.pools.get(poolKey)
      : this.resolveActivePool(projectRootPath, projectId);
    if (!pool || pool.closing || pool.quarantined) return [];
    if (poolKey && projectRootPath && pool.projectRootPath && this.projectKey(pool.projectRootPath) !== this.projectKey(projectRootPath)) {
      return [];
    }
    if (poolKey && projectId && pool.projectId && pool.projectId !== projectId.trim()) {
      return [];
    }
    return pool.manager.getAgentTools();
  }

  getRuntimeStatusSummary(projectRootPath?: string | null, projectId?: string | null): MCPServerStatusSummary[] {
    return this.resolveActivePool(projectRootPath, projectId)?.manager.getServerStatusSummary() ?? [];
  }

  /** Settings / IPC status is scoped to the requested project and never merges pools. */
  getMcpServerStatusSummary(projectRootPath?: string | null, query?: string, projectId?: string | null): MCPServerStatusSummary[] {
    const normalizedQuery = query?.trim().toLowerCase() ?? '';
    const configured = agentRuntimeConfigService.listMcpServers(projectRootPath ?? undefined)
      .filter((server) => !normalizedQuery
        || (server.id + ' ' + server.name + ' ' + server.description).toLowerCase().includes(normalizedQuery));
    const runtimeById = new Map(
      this.getRuntimeStatusSummary(projectRootPath, projectId).map((entry) => [entry.id, entry]),
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
    const statuses = await Promise.all(pools.map(async (pool) => {
      await Promise.allSettled(pool.connecting.values());
      return pool.manager.disconnectAll();
    }));
    this.reportOrphanedDisconnects(
      statuses.flat().map((detail) => detail.status),
      'MCP shutdown left an orphaned process',
    );
    for (const record of this.orphanedPools.values()) {
      this.clearOrphanDeadline(record);
      runtimeLogService.log({
        scope: 'app',
        namespace: 'agent',
        severity: 'error',
        title: 'MCP shutdown cleared quarantined orphan pool',
        summary: `Pool ${record.poolKey} was still quarantined at shutdown.`,
        raw: {
          poolKey: record.poolKey,
          projectId: record.projectId,
          supervisedCount: record.supervised.length,
        },
      });
    }
    this.orphanedPools.clear();
    this.pools.clear();
    this.activePoolByProject.clear();
  }

  private reportOrphanedDisconnects(statuses: readonly McpDisconnectStatus[], title: string): void {
    const orphanCount = statuses.filter((status) => status === 'orphaned').length;
    if (orphanCount === 0) return;
    runtimeLogService.log({
      scope: 'app',
      namespace: 'agent',
      severity: 'error',
      title,
      summary: `${orphanCount} MCP process(es) did not confirm close within the bounded join window.`,
      raw: { orphanCount },
    });
  }

  async acquireConnections(
    agentId: AgentRole,
    projectRootPath?: string | null,
    enabledMcpIds?: readonly string[],
    projectId?: string | null,
  ): Promise<AcquiredMcpConnections> {
    const descriptors = this.getEnabledMcpDescriptors(agentId, projectRootPath, enabledMcpIds);
    const normalizedProjectId = projectId?.trim() || null;
    const root = projectRootPath ? this.resolveRootPath(projectRootPath) : null;

    if (descriptors.length === 0) {
      const pools = root
        ? (() => {
            const activeMapKey = this.activeProjectMapKey(root, normalizedProjectId);
            const activeKey = this.activePoolByProject.get(activeMapKey);
            this.activePoolByProject.delete(activeMapKey);
            const activePool = activeKey ? this.pools.get(activeKey) : undefined;
            return activePool ? [activePool] : [];
          })()
        : Array.from(this.pools.values()).filter((pool) => (
          pool.projectRootPath === null
          && (normalizedProjectId === null || pool.projectId === normalizedProjectId)
        ));
      for (const pool of pools) {
        if (pool.activeTurnRefs === 0) await this.evictPool(pool);
        else pool.superseded = true;
      }
      return { errors: [], lease: null };
    }

    const descriptorHash = this.descriptorSetHash(descriptors);
    const poolKey = this.poolKey(root, normalizedProjectId, descriptorHash);

    if (this.orphanedPools.has(poolKey)) {
      throw new Error(`MCP_POOL_QUARANTINED: pool ${poolKey} is quarantined until orphaned processes exit.`);
    }

    let pool = this.pools.get(poolKey);
    if (pool?.quarantined) {
      throw new Error(`MCP_POOL_QUARANTINED: pool ${poolKey} is quarantined until orphaned processes exit.`);
    }
    if (!pool) {
      pool = {
        key: poolKey,
        projectRootPath: root,
        projectId: normalizedProjectId,
        descriptorHash,
        manager: new MCPManager(),
        connecting: new Map(),
        failedMcpServers: new Map(),
        lastUsedAt: Date.now(),
        activeTurnRefs: 0,
        closing: false,
        superseded: false,
        quarantined: false,
      };
      this.pools.set(poolKey, pool);
    }
    if (pool.closing) {
      throw new Error(`MCP pool ${poolKey} is closing; retry the turn preparation.`);
    }
    pool.activeTurnRefs += 1;
    pool.lastUsedAt = Date.now();
    if (root) {
      const activeMapKey = this.activeProjectMapKey(root, normalizedProjectId);
      this.activePoolByProject.set(activeMapKey, poolKey);
      for (const candidate of this.pools.values()) {
        if (
          candidate.key !== poolKey
          && candidate.projectRootPath
          && this.projectKey(candidate.projectRootPath) === this.projectKey(root)
          && (candidate.projectId ?? null) === normalizedProjectId
        ) {
          candidate.superseded = true;
        }
      }
    }
    const errors: string[] = [];
    const now = Date.now();
    for (const descriptor of descriptors) {
      if (pool.manager.listServers().includes(descriptor.id)) continue;
      const previous = pool.failedMcpServers.get(descriptor.id);
      if (previous) {
        if (previous.kind === 'permanent') {
          errors.push(descriptor.id + ': ' + previous.lastError);
          continue;
        }
        if (now < previous.nextRetryAt) {
          errors.push(
            descriptor.id
              + ': retry deferred until '
              + new Date(previous.nextRetryAt).toISOString()
              + ' ('
              + previous.lastError
              + ')',
          );
          continue;
        }
      }
      try {
        await this.ensurePoolServerConnected(pool, descriptor, projectRootPath);
        pool.failedMcpServers.delete(descriptor.id);
      } catch (error) {
        const record = this.recordFailure(pool, descriptor.id, error);
        errors.push(descriptor.id + ': ' + record.lastError);
      }
    }
    let released = false;
    const lease: McpConnectionLease = {
      poolKey,
      projectRootPath: root,
      projectId: normalizedProjectId,
      descriptorHash,
      release: async (options = {}) => {
        if (released) return;
        released = true;
        await this.releasePool(poolKey, options.discardIfIdle === true);
      },
    };
    return { errors, lease };
  }

  private recordFailure(pool: ProjectMcpPool, serverId: string, error: unknown): McpFailureRecord {
    const lastError = error instanceof Error ? error.message : String(error);
    const previous = pool.failedMcpServers.get(serverId);
    const kind = classifyMcpFailure(error);
    const attempts = (previous?.attempts ?? 0) + 1;
    let nextKind: McpFailureKind = kind;
    if (kind === 'retryable' && attempts >= MCP_MAX_RETRYABLE_ATTEMPTS) {
      nextKind = 'permanent';
    } else if (kind === 'permanent') {
      nextKind = 'permanent';
    }
    const record: McpFailureRecord = {
      kind: nextKind,
      attempts,
      nextRetryAt: nextKind === 'retryable' ? computeNextRetryAt(attempts) : Number.POSITIVE_INFINITY,
      lastError,
    };
    pool.failedMcpServers.set(serverId, record);
    return record;
  }

  private async releasePool(poolKey: string, discardIfIdle: boolean): Promise<void> {
    const pool = this.pools.get(poolKey);
    if (!pool) return;
    pool.activeTurnRefs = Math.max(0, pool.activeTurnRefs - 1);
    pool.lastUsedAt = Date.now();
    if (pool.activeTurnRefs > 0) return;
    if (!discardIfIdle && !pool.superseded) return;
    this.clearActiveMapping(pool);
    await this.evictPool(pool);
  }

  private async ensurePoolServerConnected(
    pool: ProjectMcpPool,
    descriptor: AgentRuntimeMcpDescriptor,
    projectRootPath?: string | null,
  ): Promise<void> {
    if (pool.manager.listServers().includes(descriptor.id)) return;
    if (pool.closing || pool.quarantined) throw new Error('MCP pool ' + pool.key + ' is closing.');
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
    if (pool.closing || pool.activeTurnRefs > 0 || pool.quarantined) return;
    pool.closing = true;
    try {
      await Promise.allSettled(pool.connecting.values());
      const details = await pool.manager.disconnectAll();
      this.reportOrphanedDisconnects(
        details.map((detail) => detail.status),
        'MCP pool eviction left an orphaned process',
      );
      const orphaned = details.filter((detail) => detail.status === 'orphaned');
      if (orphaned.length > 0) {
        this.quarantinePool(pool, orphaned);
        return;
      }
    } finally {
      if (!pool.quarantined && this.pools.get(pool.key) === pool) {
        this.pools.delete(pool.key);
        this.clearActiveMapping(pool);
      } else if (pool.quarantined) {
        // Keep identity in registry while quarantined; allow no new turns.
        pool.closing = true;
        pool.activeTurnRefs = 0;
      }
    }
  }

  private quarantinePool(pool: ProjectMcpPool, orphaned: readonly McpDisconnectDetail[]): void {
    pool.quarantined = true;
    pool.closing = true;
    const supervised = orphaned
      .map((detail) => detail.supervised)
      .filter((handle): handle is SupervisedProcess => Boolean(handle));
    const record: OrphanedPoolRecord = {
      poolKey: pool.key,
      projectRootPath: pool.projectRootPath,
      projectId: pool.projectId,
      descriptorHash: pool.descriptorHash,
      supervised,
      quarantinedAt: Date.now(),
      deadlineTimer: null,
      released: false,
    };
    this.orphanedPools.set(pool.key, record);
    this.clearActiveMapping(pool);
    // Keep pool entry so poolKey identity remains reserved.
    this.pools.set(pool.key, pool);

    runtimeLogService.log({
      scope: 'app',
      namespace: 'agent',
      severity: 'error',
      title: 'MCP pool quarantined after orphan disconnect',
      summary: `Pool ${pool.key} blocked for re-acquire until supervised process exit.`,
      raw: {
        poolKey: pool.key,
        projectId: pool.projectId,
        orphanCount: orphaned.length,
      },
    });

    record.deadlineTimer = setTimeout(() => {
      if (record.released) return;
      runtimeLogService.log({
        scope: 'app',
        namespace: 'agent',
        severity: 'error',
        title: 'MCP orphan quarantine deadline exceeded',
        summary: `Pool ${pool.key} still orphaned after ${MCP_ORPHAN_DEADLINE_MS}ms; identity remains reserved.`,
        raw: {
          poolKey: pool.key,
          projectId: pool.projectId,
          supervisedCount: record.supervised.length,
        },
      });
    }, MCP_ORPHAN_DEADLINE_MS);
    record.deadlineTimer.unref?.();

    if (supervised.length === 0) {
      // No handle to observe; keep quarantined until shutdown disconnectAll.
      return;
    }
    void Promise.allSettled(supervised.map((handle) => handle.exit)).then(() => {
      this.releaseOrphanQuarantine(pool.key);
    });
  }

  private releaseOrphanQuarantine(poolKey: string): void {
    const record = this.orphanedPools.get(poolKey);
    if (!record || record.released) return;
    record.released = true;
    this.clearOrphanDeadline(record);
    this.orphanedPools.delete(poolKey);
    const pool = this.pools.get(poolKey);
    if (pool) {
      pool.quarantined = false;
      this.pools.delete(poolKey);
      this.clearActiveMapping(pool);
    }
    runtimeLogService.log({
      scope: 'app',
      namespace: 'agent',
      severity: 'info',
      title: 'MCP orphan quarantine released',
      summary: `Pool ${poolKey} identity released after supervised exit.`,
      raw: { poolKey, projectId: record.projectId },
    });
  }

  private clearOrphanDeadline(record: OrphanedPoolRecord): void {
    if (record.deadlineTimer) {
      clearTimeout(record.deadlineTimer);
      record.deadlineTimer = null;
    }
  }

  private clearActiveMapping(pool: ProjectMcpPool): void {
    if (!pool.projectRootPath) return;
    const activeMapKey = this.activeProjectMapKey(pool.projectRootPath, pool.projectId);
    if (this.activePoolByProject.get(activeMapKey) === pool.key) {
      this.activePoolByProject.delete(activeMapKey);
    }
  }

  private resolveActivePool(projectRootPath?: string | null, projectId?: string | null): ProjectMcpPool | undefined {
    if (projectRootPath) {
      const root = this.resolveRootPath(projectRootPath);
      const activeMapKey = this.activeProjectMapKey(root, projectId?.trim() || null);
      const key = this.activePoolByProject.get(activeMapKey);
      if (key) {
        const pool = this.pools.get(key);
        if (pool && !pool.quarantined) return pool;
      }
      // Fallback: if projectId omitted, prefer unique active pool under this root.
      if (!projectId?.trim()) {
        const rootKey = this.projectKey(root);
        const matches = Array.from(this.activePoolByProject.entries())
          .filter(([mapKey]) => mapKey.startsWith(`${rootKey}::`))
          .map(([, poolKey]) => this.pools.get(poolKey))
          .filter((pool): pool is ProjectMcpPool => Boolean(pool && !pool.quarantined));
        if (matches.length === 1) return matches[0];
      }
      return undefined;
    }
    if (!projectRootPath && this.pools.size === 1) {
      const only = this.pools.values().next().value as ProjectMcpPool | undefined;
      return only && !only.quarantined ? only : undefined;
    }
    return undefined;
  }

  private resolveRootPath(projectRootPath: string): string {
    return canonicalMcpProjectRoot(projectRootPath);
  }

  private projectKey(projectRootPath: string): string {
    return canonicalMcpProjectRoot(projectRootPath);
  }

  private activeProjectMapKey(projectRootPath: string, projectId: string | null): string {
    const rootKey = this.projectKey(projectRootPath);
    const idPart = projectId?.trim() ? encodeURIComponent(projectId.trim()) : '<no-project>';
    return `${rootKey}::${idPart}`;
  }

  private poolKey(projectRootPath: string | null, projectId: string | null, descriptorHash: string): string {
    const rootKey = projectRootPath ? this.projectKey(projectRootPath) : '<user>';
    const projectKey = projectId ? encodeURIComponent(projectId) : '<no-project>';
    return `${rootKey}:${projectKey}:${descriptorHash}`;
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
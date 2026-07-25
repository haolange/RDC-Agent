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
import { settingsService } from '../../settings/SettingsService';

export class McpConnectionCoordinator {
  private readonly mcpManager = new MCPManager();
  private readonly connectedMcpServerIds = new Set<string>();
  private readonly failedMcpServers = new Map<string, string>();
  private readonly mcpConnectionMeta = new Map<string, { projectRoot: string | null; descriptorHash: string }>();

  getAgentTools(): AgentTool[] {
    return this.mcpManager.getAgentTools();
  }

  getRuntimeStatusSummary(): MCPServerStatusSummary[] {
    return this.mcpManager.getServerStatusSummary();
  }

  /**
   * Settings / IPC 与 mcp 目录工具共用：合并已配置 MCP 与运行时连接状态。
   */
  getMcpServerStatusSummary(projectRootPath?: string | null, query?: string): MCPServerStatusSummary[] {
    const normalizedQuery = query?.trim().toLowerCase() ?? '';
    const configured = agentRuntimeConfigService.listMcpServers(projectRootPath ?? undefined)
      .filter((server) => !normalizedQuery
        || `${server.id} ${server.name} ${server.description}`.toLowerCase().includes(normalizedQuery));
    const runtimeById = new Map(
      this.getRuntimeStatusSummary().map((entry) => [entry.id, entry]),
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
      if (runtime?.lastError) {
        summary.lastError = runtime.lastError;
      }
      return summary;
    });
  }

  async disconnectAll(): Promise<void> {
    await this.mcpManager.disconnectAll();
    this.connectedMcpServerIds.clear();
    this.failedMcpServers.clear();
    this.mcpConnectionMeta.clear();
  }

  async ensureConnections(agentId: AgentRole, projectRootPath?: string | null): Promise<string[]> {
    const errors: string[] = [];
    const nextProjectRoot = projectRootPath ? path.resolve(projectRootPath) : null;
    const descriptors = this.getEnabledMcpDescriptors(agentId, projectRootPath);
    const desiredById = new Map(
      descriptors.map((descriptor) => [descriptor.id, descriptor] as const),
    );

    for (const serverId of Array.from(this.connectedMcpServerIds)) {
      const meta = this.mcpConnectionMeta.get(serverId);
      const desired = desiredById.get(serverId);
      const desiredHash = desired ? this.hashMcpDescriptor(desired) : null;
      const stillValid = Boolean(
        desired
        && meta
        && meta.projectRoot === nextProjectRoot
        && meta.descriptorHash === desiredHash,
      );
      if (stillValid) continue;
      await this.mcpManager.disconnect(serverId);
      this.connectedMcpServerIds.delete(serverId);
      this.mcpConnectionMeta.delete(serverId);
      this.failedMcpServers.delete(serverId);
    }

    for (const descriptor of descriptors) {
      if (this.connectedMcpServerIds.has(descriptor.id)) {
        continue;
      }
      if (this.failedMcpServers.has(descriptor.id)) {
        errors.push(`${descriptor.id}: ${this.failedMcpServers.get(descriptor.id)}`);
        continue;
      }
      try {
        mcpTrustService.assertConnectAllowed(descriptor, projectRootPath);
        await this.mcpManager.connect(this.toMcpServerConfig(descriptor));
        this.connectedMcpServerIds.add(descriptor.id);
        this.mcpConnectionMeta.set(descriptor.id, {
          projectRoot: nextProjectRoot,
          descriptorHash: this.hashMcpDescriptor(descriptor),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.failedMcpServers.set(descriptor.id, message);
        errors.push(`${descriptor.id}: ${message}`);
      }
    }
    return errors;
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

  private getEnabledMcpDescriptors(agentId: AgentRole, projectRootPath?: string | null): AgentRuntimeMcpDescriptor[] {
    const settings = settingsService.getAll();
    const manifest = settings.agents.definitions.find((entry) => entry.id === agentId && entry.enabled);
    const enabledIds = new Set(manifest?.mcpServers ?? []);
    if (enabledIds.size === 0) {
      return [];
    }
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

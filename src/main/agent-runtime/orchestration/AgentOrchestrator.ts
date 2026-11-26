/**
 * AgentOrchestrator — façade over turn preparation, profile turns, credential leases, background subagents and MCP.
 *
 * Public contract: `prepareTurnContext` / `sendProfileMessage` / `abortAndJoin`. A profile turn runs in
 * ProfileTurnRunner; LLM streaming and tool gating stay in AgentTurnRunner; permissions stay in
 * AgentPermissionPolicy. The composition root (`agentRuntimeRoot.ts`) constructs every collaborator and passes them
 * in; this file depends on their types only.
 */

import { turnCoordinator, type AbortReason } from './TurnCoordinator';
import type { MCPServerStatusSummary } from '@shared/types/mcp';
import type { LlmProviderId } from '@shared/types/settings';
import type { AgentSlotRegistry } from './AgentSlotRegistry';
import type { BackgroundSubagentService } from './BackgroundSubagentService';
import type { DeferredToolActivationTracker } from './DeferredToolActivationTracker';
import type { McpConnectionCoordinator } from './McpConnectionCoordinator';
import type { PreparedProfileTurn, ProfileTurnRunner } from './ProfileTurnRunner';
import type { ProviderRouteCredentials } from './ProviderRouteCredentials';
import type { ToolExecutorFactory } from './ToolExecutorFactory';
import type { TurnPreparationService } from './TurnPreparationService';
import type { PreparedAgentTurnContext } from './orchestratorTypes';

/** The collaborators the composition root constructs for the façade. */
export interface AgentOrchestratorCollaborators {
  slots: AgentSlotRegistry;
  mcp: McpConnectionCoordinator;
  deferredActivation: DeferredToolActivationTracker;
  credentials: ProviderRouteCredentials;
  toolExecutors: ToolExecutorFactory;
  turnPrep: TurnPreparationService;
  profileTurns: ProfileTurnRunner;
  backgroundSubagents: BackgroundSubagentService;
}

export class AgentOrchestrator {
  private readonly slots: AgentSlotRegistry;
  private readonly mcp: McpConnectionCoordinator;
  private readonly deferredActivation: DeferredToolActivationTracker;
  private readonly credentials: ProviderRouteCredentials;
  private readonly toolExecutors: ToolExecutorFactory;
  private readonly turnPrep: TurnPreparationService;
  private readonly profileTurns: ProfileTurnRunner;
  readonly backgroundSubagents: BackgroundSubagentService;

  constructor(collaborators: AgentOrchestratorCollaborators) {
    this.slots = collaborators.slots;
    this.mcp = collaborators.mcp;
    this.deferredActivation = collaborators.deferredActivation;
    this.credentials = collaborators.credentials;
    this.toolExecutors = collaborators.toolExecutors;
    this.turnPrep = collaborators.turnPrep;
    this.profileTurns = collaborators.profileTurns;
    this.backgroundSubagents = collaborators.backgroundSubagents;
  }

  /** Re-reads the Agent model routes Settings assigns (after a settings or credential change). */
  applyLlmConfig(): void {
    this.credentials.applyLlmConfig();
  }

  syncSessionSlots(sessionId: string): void {
    this.slots.syncSession(sessionId);
    this.deferredActivation.clearSession(sessionId);
  }

  releaseSessionToolState = (sessionId: string): void => this.toolExecutors.releaseSession(sessionId);

  refreshProviderRuntimeCredentials(providerId: LlmProviderId): Promise<string> {
    return this.credentials.refresh(providerId);
  }

  releaseProviderRuntimeCredentials(credentialHandle: string | undefined): void {
    this.credentials.release(credentialHandle);
  }

  async prepareTurnContext(
    input: Parameters<TurnPreparationService['prepareTurnContext']>[0],
  ): Promise<PreparedAgentTurnContext> {
    return this.turnPrep.prepareTurnContext(input);
  }

  /** Runs a conversation turn on the runtime `prepareTurnContext` froze for it. */
  sendProfileMessage(turn: PreparedProfileTurn): Promise<string> {
    return this.profileTurns.sendPrepared(turn);
  }

  async abortAndJoin(
    sessionId: string | null | undefined,
    options?: { graceMs?: number; forceAfterMs?: number; reason?: AbortReason },
  ): Promise<void> {
    const key = sessionId?.trim();
    if (!key) return;
    // use resolved key without generating a new ephemeral scope
    const handle = turnCoordinator.getActive(key);
    if (!handle) {
      await turnCoordinator.abortSession(key, options?.reason ?? 'user_stop');
      return;
    }
    await handle.abortAndJoin({
      graceMs: options?.graceMs,
      forceAfterMs: options?.forceAfterMs,
      reason: options?.reason ?? 'user_stop',
    });
    turnCoordinator.endTurn(handle);
  }

  getMcpServerStatusSummary(projectRootPath?: string | null): MCPServerStatusSummary[] {
    return this.mcp.getMcpServerStatusSummary(projectRootPath);
  }

  async disconnectAllMcpServers(): Promise<void> {
    await this.mcp.disconnectAll();
  }

  /** Manual `/mcp connect` and `/mcp disconnect`: the connection coordinator that turns use, not a second path. */
  get mcpConnections(): Pick<McpConnectionCoordinator, 'connectServer' | 'disconnectServer'> {
    return this.mcp;
  }
}

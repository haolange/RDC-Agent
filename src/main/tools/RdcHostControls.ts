import type { ToolExecutionContext } from '../agent-runtime/agent/AgentTool';
import { sessionArtifactResolver } from '../sessions/SessionArtifactResolver';
import { PROCESS_TERMINATION_POLICY } from '../runtime/ProcessSupervisor';
import { ownsRdcInteractionLock } from '../sessions/RdcOperationCoordinator';
import { assertRdcContextLeaseOwnership, getRdcContextLease, listRdcContextLeaseSessionIds } from '../sessions/RdcRuntimeContextRegistry';

export interface RdcHostControlScope {
  sessionId: string;
  projectId: string;
  contextId: string;
  leaseVersion: number;
}

function readReplayIsolation(scope: RdcHostControlScope, context?: ToolExecutionContext) {
  const unavailable = { available: false as const, reason: 'protected_owning_general_turn_not_verified' };
  const identity = context?.rdcBinding?.identity;
  if (context?.agentId !== 'general' || context.excludeRdcLeaseTools || !context.turnId || !context.rdcBinding?.cli.enabled
    || identity?.ownerSessionId !== scope.sessionId || identity.contextId !== scope.contextId
    || identity.version !== scope.leaseVersion || !ownsRdcInteractionLock(scope.sessionId, context.turnId)) return unavailable;
  const lease = assertRdcContextLeaseOwnership(scope);
  if (!lease || lease.delegatedFrom || lease.version !== scope.leaseVersion
    || !lease.runtimeContext.captureFileId || !lease.runtimeContext.replaySessionId
    || lease.runtimeContext.captureFileId !== identity.runtimeContext?.captureFileId
    || lease.runtimeContext.replaySessionId !== identity.runtimeContext?.replaySessionId) return unavailable;
  if (listRdcContextLeaseSessionIds().some(id => id !== scope.sessionId
    && getRdcContextLease(id)?.contextId === scope.contextId)) return unavailable;
  return { available: true as const, source: 'main-owned-lease-and-turn-lock' as const,
    scope: 'rdc-agent-context' as const, exclusive: true as const,
    sessionId: scope.sessionId, projectId: scope.projectId, turnId: context.turnId,
    contextId: scope.contextId, leaseVersion: scope.leaseVersion,
    replaySessionId: lease.runtimeContext.replaySessionId, captureFileId: lease.runtimeContext.captureFileId,
    nativeBatchLock: false, excludesExternalProcesses: false };
}

/** Exposes controls, not private CLI configuration or a future execution guarantee. */
export function readRdcHostControls(scope: RdcHostControlScope, context?: ToolExecutionContext) {
  const measuredAt = Date.now();
  if (context && (context.projectId !== scope.projectId || context.sessionId !== scope.sessionId)) {
    return { measuredAt, available: false, reason: 'execution_scope_mismatch' };
  }
  let artifactCapacity;
  try {
    artifactCapacity = { available: true as const, scope: 'session-artifacts' as const,
      ...sessionArtifactResolver.getQuotaCapacity(scope.sessionId) };
  } catch {
    artifactCapacity = { available: false as const, reason: 'session_artifact_capacity_unavailable' };
  }
  const binding = context?.rdcBinding;
  const identity = binding?.identity;
  const matched = identity?.ownerSessionId === scope.sessionId && identity.contextId === scope.contextId
    && identity.version === scope.leaseVersion;
  const timeoutMs = matched && binding?.cli.enabled ? binding.cli.timeoutMs : undefined;
  const cliProcess = typeof timeoutMs === 'number' && Number.isSafeInteger(timeoutMs) && timeoutMs > 0
    ? { available: true as const, source: 'frozen-turn-cli' as const, timeoutMs,
      termination: PROCESS_TERMINATION_POLICY, scope: 'one-cli-invocation' as const,
      wholeOperationDeadline: false, nativeTerminationGuaranteed: false,
      postOperationObservationMayInvokeCli: true,
      uncertainOutcome: 'quarantine-owning-context' as const }
    : { available: false as const, reason: 'matching_frozen_cli_timeout_unavailable' };
  const replayIsolation = readReplayIsolation(scope, context);
  const available = artifactCapacity.available || cliProcess.available || replayIsolation.available;
  return { measuredAt, available, ...(!available ? { reason: 'host_controls_unavailable' } : {}), artifactCapacity, cliProcess, replayIsolation };
}

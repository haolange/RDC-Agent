import type { ToolExecutionContext } from '../agent-runtime/agent/AgentTool';
import { sessionArtifactResolver } from '../sessions/SessionArtifactResolver';
import { PROCESS_TERMINATION_POLICY } from '../runtime/ProcessSupervisor';

export interface RdcHostControlScope {
  sessionId: string;
  projectId: string;
  contextId: string;
  leaseVersion: number;
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
  const available = artifactCapacity.available || cliProcess.available;
  return { measuredAt, available, ...(!available ? { reason: 'host_controls_unavailable' } : {}), artifactCapacity, cliProcess };
}

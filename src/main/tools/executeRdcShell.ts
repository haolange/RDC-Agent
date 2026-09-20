import { authorizeRdcOperation } from './RdcOperationPolicy';
import { operationFingerprint } from './RdcOperationCatalog';
import { validateExecutionEvidence, verifyRollbackIdentity } from './RdcValidatedEvidence';
import { runRdcOperation } from '../sessions/RdcOperationCoordinator';
import { z } from 'zod';
import type { AgentToolResult, ToolExecutionContext } from '../agent-runtime/agent/AgentTool';
import { assertRdcContextLeaseOwnership, getRdcContextLease, quarantineRdcContext } from '../sessions/RdcRuntimeContextRegistry';
import { rdcCliInvokerService } from './RdcCliInvokerService';
import { parseRdcNativeResult } from './RdcNativeProtocol';
import { rdcDigest, rdcExecutionReceipts } from './RdcExecutionReceipts';
import { truncateOutput } from '../agent-runtime/tools/primitives/_shared';

export const RdcDiscoverySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('search'), query: z.string().trim().min(1).max(200), limit: z.number().int().min(1).max(20).default(8) }).strict(),
  z.object({ kind: z.literal('describe'), operation: z.string().regex(/^rd[.][a-z_]+[.][a-z0-9_]+$/) }).strict(),
]);
export const RdcShellInputSchema = z.union([
  z.object({ operation: z.string().regex(/^rd[.][a-z_]+[.][a-z0-9_]+$/), args: z.record(z.string(), z.unknown()), experimentId: z.string().trim().min(1).max(128).optional() }).strict(),
  z.object({ discovery: RdcDiscoverySchema }).strict(),
]);
export type RdcShellInput = z.infer<typeof RdcShellInputSchema>;

export async function executeRdcShell(
  raw: RdcShellInput, toolCallId: string, signal: AbortSignal | undefined, context?: ToolExecutionContext,
): Promise<AgentToolResult<{ operation: string; exitCode: number; receipt?: import("@shared/types/renderdocInvestigation").InvestigationContentRef }>> {
  const input = RdcShellInputSchema.parse(raw);
  signal?.throwIfAborted();
  if (context?.agentId !== 'general' || context.excludeRdcLeaseTools || !context.sessionId || !context.projectId || !context.turnId) {
    throw new Error('RDC_EXECUTION_DENIED: only the owning General turn may execute native operations.');
  }
  const lease = assertRdcContextLeaseOwnership({ sessionId: context.sessionId, projectId: context.projectId });
  const retainedLease = !lease ? getRdcContextLease(context.sessionId) : null;
  if (retainedLease?.ownerProjectId === context.projectId && retainedLease.quarantineReason) {
    throw new Error('RDC_CONTEXT_QUARANTINED: replay outcome is uncertain; close and reopen the capture before execution.');
  }
  const cli = context.rdcBinding?.cli;
  const identity = context.rdcBinding?.identity;
  if (!lease || !identity || identity.version !== lease.version || identity.contextId !== lease.contextId || identity.ownerSessionId !== context.sessionId) {
    throw new Error('RDC_EXECUTION_DENIED: binding changed since prepareTurn; prepare a new turn before execution.');
  }
  if (!lease || lease.delegatedFrom || lease.ownerSessionId !== context.sessionId || lease.ownerProjectId !== context.projectId || lease.contextId === 'default'
    || !lease.runtimeContext.replaySessionId || !cli?.enabled || !cli.command.trim()) {
    throw new Error('RDC_EXECUTION_DENIED: requires a frozen binding and an owned replay session.');
  }
  if ('discovery' in input) {
    const binding = context.rdcBinding!;
    if (operationFingerprint(binding.definitions) !== binding.definitionsFingerprint) throw new Error('RDC_EXECUTION_DENIED: invalid frozen catalog.');
    const request = input.discovery;
    let data: unknown;
    if (request.kind === 'describe') {
      data = binding.definitions.find(item => item.name === request.operation);
      if (!data) throw new Error('RDC_EXECUTION_DENIED: unknown operation.');
    } else {
      const terms = request.query.toLowerCase().split(/\s+/);
      const matches = binding.definitions.filter(item => terms.every(term => `${item.name} ${item.description}`.toLowerCase().includes(term)));
      data = { matches: matches.slice(0, request.limit).map(item => ({ name: item.name, description: item.description, scope: item.scope, effects: item.effects })), total: matches.length, truncated: matches.length > request.limit };
    }
    return { content: [{ type: 'text', text: JSON.stringify({ fingerprint: binding.definitionsFingerprint, data }) }], details: { operation: `rdc_tool.tools.${request.kind}`, exitCode: 0 } };
  }
  const sessionId = context.sessionId; const projectId = context.projectId; const turnId = context.turnId;
  const replaySessionId = lease.runtimeContext.replaySessionId;
  const frozenCaptureId = identity.runtimeContext?.captureFileId;
  if (frozenCaptureId !== lease.runtimeContext.captureFileId || identity.runtimeContext?.replaySessionId !== replaySessionId) {
    throw new Error('RDC_EXECUTION_DENIED: capture/replay identity changed since prepareTurn.');
  }
  const { definition, args } = authorizeRdcOperation(input.operation, input.args, context, replaySessionId, frozenCaptureId);
  if (input.experimentId && !definition.evidence_kind) throw new Error('RDC_EVIDENCE_INVALID: operation has no supported evidence capability.');
  verifyRollbackIdentity(definition, args, lease.contextId, input.experimentId);
  // Establish durable signing capability before a potentially mutating call.
  if (input.experimentId) rdcExecutionReceipts.prepare();
  return runRdcOperation(lease.contextId, async () => {
  signal?.throwIfAborted();
  const queuedLease = assertRdcContextLeaseOwnership({ sessionId, projectId });
  if (!queuedLease || queuedLease.version !== lease.version || queuedLease.contextId !== lease.contextId) {
    throw new Error('RDC_EXECUTION_DENIED: binding changed while queued.');
  }
  const startedAt = Date.now();
  try {
    const readReplayEvent = async (): Promise<number> => {
      const response = await rdcCliInvokerService.executeCLI('call', [
        'rd.session.get_context', '--args-json', '{}', '--daemon-context', lease.contextId,
      ], { abortSignal: signal, contextId: lease.contextId, settings: cli });
      const snapshot = parseRdcNativeResult(response, undefined, 'rd.session.get_context');
      const runtime = snapshot.data.runtime as Record<string, unknown> | undefined;
      if (snapshot.data.context_id !== lease.contextId || snapshot.data.current_session_id !== replaySessionId
        || !Number.isSafeInteger(runtime?.active_event_id) || Number(runtime?.active_event_id) < 0) {
        throw new Error('RDC_CLI_PROTOCOL: cannot verify temporary replay identity and position.');
      }
      return Number(runtime!.active_event_id);
    };
    const originalEvent = definition.effects.includes('replay_position_temporary') ? await readReplayEvent() : undefined;
    const result = await rdcCliInvokerService.executeCLI('call', [
      input.operation, '--args-json', JSON.stringify(args), '--daemon-context', lease.contextId,
    ], { abortSignal: signal, contextId: lease.contextId, settings: cli });
    signal?.throwIfAborted();
    const payload = parseRdcNativeResult(result, undefined, input.operation);
    if (payload.result_kind !== input.operation
      || (payload.data.context_id !== undefined && payload.data.context_id !== lease.contextId)
      || (payload.data.session_id !== undefined && payload.data.session_id !== replaySessionId)
      || (definition.scope === 'capture' && payload.data.capture_file_id !== frozenCaptureId)) {
      throw new Error('RDC_CLI_PROTOCOL: operation or replay identity mismatch; no receipt issued.');
    }
    const after = assertRdcContextLeaseOwnership({ sessionId: sessionId, projectId: projectId });
    if (!after || after.version !== lease.version || after.contextId !== lease.contextId) {
      throw new Error('RDC_EXECUTION_DENIED: replay ownership changed during execution; inspect state before retrying.');
    }
    if (originalEvent !== undefined && (payload.data.replay_state_restored !== true
      || payload.data.restored_event_id !== originalEvent || await readReplayEvent() !== originalEvent)) {
      throw new Error('RDC_CLI_PROTOCOL: temporary replay operation did not prove restoration.');
    }
    const evidence = input.experimentId ? await validateExecutionEvidence(definition, args, payload.data, context, lease.contextId, input.experimentId) : null;
    signal?.throwIfAborted();
    const receipt = input.experimentId && evidence ? rdcExecutionReceipts.write({
      schemaVersion: 1, sessionId: sessionId, projectId: projectId,
      turnId: turnId, toolCallId, experimentId: input.experimentId,
      contextId: lease.contextId, leaseVersion: lease.version, replaySessionId: replaySessionId,
      operation: input.operation, definitionsFingerprint: context.rdcBinding!.definitionsFingerprint, evidence, args, argsFingerprint: rdcDigest(args),
      result: payload.data, resultHash: rdcDigest(payload.data), startedAt, completedAt: Date.now(), exitCode: 0,
    }, signal) : undefined;
    // Perf dispatch awaits all sampling before returning; observe only after its completed result and receipt.
    if (definition.effects.some(effect => ['replay_position', 'shader_replacement'].includes(effect))) {
      const { rdcSessionService } = await import('../sessions');
      await rdcSessionService.observeAgentOperation({ sessionId: sessionId, projectId: projectId }, input.operation, toolCallId, cli, true);
    }
    return { content: [{ type: 'text', text: truncateOutput(JSON.stringify({ result: payload, receipt }), 24 * 1024) }],
      details: { operation: input.operation, exitCode: 0, receipt } };
  } catch (error) {
    quarantineRdcContext(sessionId, lease.version, 'Native operation outcome is uncertain; inspect and recover through the capture lifecycle before further execution.');
    throw error;
  }
  });
}

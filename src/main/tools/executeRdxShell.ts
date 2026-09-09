import { z } from 'zod';
import type { AgentToolResult, ToolExecutionContext } from '../agent-runtime/agent/AgentTool';
import { getRdxContextLease } from '../sessions/RdxRuntimeContextRegistry';
import { rdxCliInvokerService } from './RdxCliInvokerService';
import { parseRdxNativeResult } from './RdxNativeProtocol';
import { rdxDigest, rdxExecutionReceipts } from './RdxExecutionReceipts';
import { truncateOutput } from '../agent-runtime/tools/primitives/_shared';

export const RdxShellInputSchema = z.object({
  operation: z.string().regex(/^rd[.](shader|perf|event|pipeline|resource|export)[.][a-z][a-z0-9_]*$/),
  args: z.record(z.string(), z.unknown()),
  experimentId: z.string().trim().min(1).max(128).optional(),
}).strict();
export type RdxShellInput = z.infer<typeof RdxShellInputSchema>;

export async function executeRdxShell(
  raw: RdxShellInput, toolCallId: string, signal: AbortSignal | undefined, context?: ToolExecutionContext,
): Promise<AgentToolResult<{ operation: string; exitCode: number; receipt?: import("@shared/types/renderdocInvestigation").InvestigationContentRef }>> {
  const input = RdxShellInputSchema.parse(raw);
  signal?.throwIfAborted();
  if (context?.agentId !== 'general' || context.excludeRdxLeaseTools || !context.sessionId || !context.projectId || !context.turnId) {
    throw new Error('RDX_EXECUTION_DENIED: only the owning General turn may execute native operations.');
  }
  const lease = getRdxContextLease(context.sessionId);
  const cli = context.rdxBinding?.cli;
  if (!lease || lease.delegatedFrom || lease.ownerSessionId !== context.sessionId || lease.ownerProjectId !== context.projectId || lease.contextId === 'default'
    || !lease.runtimeContext.replaySessionId || !cli?.enabled || !cli.command.trim()) {
    throw new Error('RDX_EXECUTION_DENIED: requires a frozen binding and an owned replay session.');
  }
  for (const name of Object.keys(input.args)) {
    if (/^(session_?id|context_?id|daemon_?context|owner_?session_?id)$/i.test(name)) {
      throw new Error('RDX_EXECUTION_DENIED: replay identity is main-owned.');
    }
  }
  const args = { ...input.args, session_id: lease.runtimeContext.replaySessionId };
  // Establish durable signing capability before a potentially mutating call.
  if (input.experimentId) rdxExecutionReceipts.prepare();
  const startedAt = Date.now();
  const result = await rdxCliInvokerService.executeCLI('call', [
    input.operation, '--args-json', JSON.stringify(args), '--daemon-context', lease.contextId,
  ], { abortSignal: signal, settings: { ...cli, argsPrefix: [...cli.argsPrefix, '--json'] } });
  signal?.throwIfAborted();
  const payload = parseRdxNativeResult(result);
  if (payload.result_kind !== input.operation
    || (payload.data.session_id !== undefined && payload.data.session_id !== lease.runtimeContext.replaySessionId)) {
    throw new Error('RDX_CLI_PROTOCOL: operation or replay identity mismatch; no receipt issued.');
  }
  const after = getRdxContextLease(context.sessionId);
  if (!after || after.version !== lease.version || after.contextId !== lease.contextId) {
    throw new Error('RDX_EXECUTION_DENIED: replay ownership changed during execution; inspect state before retrying.');
  }
  const receipt = input.experimentId ? rdxExecutionReceipts.write({
    schemaVersion: 1, sessionId: context.sessionId, projectId: context.projectId,
    turnId: context.turnId, toolCallId, experimentId: input.experimentId,
    contextId: lease.contextId, leaseVersion: lease.version, replaySessionId: lease.runtimeContext.replaySessionId,
    operation: input.operation, args, argsFingerprint: rdxDigest(args),
    result: payload.data, resultHash: rdxDigest(payload.data), startedAt, completedAt: Date.now(), exitCode: 0,
  }, signal) : undefined;
  return { content: [{ type: 'text', text: truncateOutput(JSON.stringify({ result: payload, receipt }), 24 * 1024) }],
    details: { operation: input.operation, exitCode: 0, receipt } };
}

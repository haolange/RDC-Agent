import { z } from 'zod';
import { parseJsonValue } from '@shared/utils/jsonValue';
import { lifecycleLedger } from '../runtime/LifecycleLedger';
import { currentProcessExecutionOwner } from '../runtime/ResourceExecutionLifetime';
import type { CLIResult } from '../tools/ShellInvocationService';

type TerminalOutcome = 'completed' | 'failed' | 'stuck' | 'cancelled' | 'worker-lost';

const OUTCOME_BY_CODE: Record<string, TerminalOutcome> = {
  worker_stuck: 'stuck',
  operation_cancelled: 'cancelled',
  worker_lost: 'worker-lost',
  worker_request_failed: 'worker-lost',
};

/** Only what the ledger keeps from a canonical envelope: success, the error code and the worker's exit facts. */
const EnvelopeOutcomeSchema = z.object({
  ok: z.boolean(),
  error: z
    .object({
      code: z.string(),
      details: z
        .object({
          reason: z.string().optional(),
          worker: z.object({ pid: z.number().int().optional() }).optional(),
          worker_exit_confirmed: z.boolean().optional(),
        })
        .optional(),
    })
    .nullish(),
});

export interface RdcOperationIdentity {
  operation: string;
  requestId: string;
  contextId?: string;
}

function owner(identity: RdcOperationIdentity) {
  const sessionId = currentProcessExecutionOwner();
  return {
    ...(sessionId ? { sessionId } : {}),
    ...(identity.contextId ? { contextId: identity.contextId } : {}),
    operation: identity.operation,
    requestId: identity.requestId,
  };
}

/** Records that an RDC operation was handed to RDC-Tool, so a crash during it names the operation in flight. */
export function recordRdcOperationStarted(identity: RdcOperationIdentity): void {
  lifecycleLedger.record({ kind: 'rdc_operation', phase: 'started', ...owner(identity) });
}

function envelopeOutcome(result: CLIResult) {
  try {
    const parsed = EnvelopeOutcomeSchema.safeParse(parseJsonValue(result.stdout));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Records how an RDC operation ended: completed, failed with a code, stuck, cancelled or lost with its worker. Arguments
 * and paths are never written; the worker's exit facts are, because they explain a replaced worker later.
 */
export function recordRdcOperationTerminal(identity: RdcOperationIdentity, result: CLIResult | Error): void {
  if (result instanceof Error) {
    const errorCode = 'code' in result && typeof result.code === 'string' ? result.code : result.name;
    lifecycleLedger.record({
      kind: 'rdc_operation',
      phase: 'terminal',
      ...owner(identity),
      outcome: 'failed',
      errorCode,
    });
    return;
  }
  const envelope = envelopeOutcome(result);
  const code = envelope?.error?.code;
  const details = envelope?.error?.details;
  const outcome: TerminalOutcome = envelope?.ok
    ? 'completed'
    : ((code ? OUTCOME_BY_CODE[code] : undefined) ?? 'failed');
  lifecycleLedger.record({
    kind: 'rdc_operation',
    phase: 'terminal',
    ...owner(identity),
    outcome,
    ...(code ? { errorCode: code } : envelope ? {} : { errorCode: `exit_${result.exitCode}` }),
    ...(details?.worker
      ? {
          workerExit: {
            ...(details.worker.pid !== undefined ? { pid: details.worker.pid } : {}),
            reason: details.reason ?? code ?? 'unknown',
            confirmed: details.worker_exit_confirmed ?? false,
          },
        }
      : {}),
  });
}

import { isDeepStrictEqual } from 'node:util';
import { AppError } from '@shared/errors/appError';
import { rdcDigest } from './RdcExecutionReceipts';
import { parseRdcNativeResult, RdcNativeFailure } from './RdcNativeProtocol';
import { runRdcOperation } from './RdcOperationCoordinator';
import { parseRdcProcessIdentity } from './RdcProcessIdentity';
import { quarantineFatalReplayFailure } from './RdcReplayFailure';
import {
  assertRdcContextLeaseOwnership,
  quarantineRdcContext,
  type RdcContextLease,
} from './RdcRuntimeContextRegistry';
import { validateRdcSwitchSnapshot, type RdcSwitchSnapshot } from './RdcSwitchSnapshot';
import type { RdcCliInvokerSettings } from '@shared/types/settings';
import type { CLIResult } from '../tools/ShellInvocationService';

type Execute = (
  command: string,
  args: string[],
  options: {
    abortSignal?: AbortSignal;
    settings?: RdcCliInvokerSettings;
    contextId?: string;
  },
) => Promise<CLIResult>;

/** A planning query may visit an event, but it must leave the owning replay at its entry position. */
export async function executePreservedPipelineProbe(input: {
  lease: RdcContextLease;
  settings: RdcCliInvokerSettings;
  args: string[];
  signal?: AbortSignal;
  execute: Execute;
}): Promise<CLIResult> {
  const { lease, settings, signal, execute } = input;
  const options = { settings, contextId: lease.contextId, abortSignal: signal };
  const currentLease = () => {
    const current = assertRdcContextLeaseOwnership({
      sessionId: lease.ownerSessionId,
      projectId: lease.ownerProjectId,
    });
    if (!current || current.version !== lease.version || current.contextId !== lease.contextId) {
      throw new AppError('RDC_PROBE_OWNER', 'replay ownership changed during the pipeline query.');
    }
    return current;
  };
  const snapshot = async () => {
    signal?.throwIfAborted();
    currentLease();
    const response = await execute(
      'call',
      ['rd.session.get_context', '--args-json', '{}', '--daemon-context', lease.contextId],
      options,
    );
    return validateRdcSwitchSnapshot(
      parseRdcNativeResult(response, lease.contextId, 'rd.session.get_context'),
      currentLease(),
    );
  };
  const sameReplay = (a: RdcSwitchSnapshot, b: RdcSwitchSnapshot) =>
    isDeepStrictEqual({ ...a, eventId: 0 }, { ...b, eventId: 0 });
  const quarantineFatal = (error: unknown) =>
    quarantineFatalReplayFailure(lease, error, 'rd.pipeline.get_state', input.args);

  return runRdcOperation(lease.contextId, async () => {
    let before: RdcSwitchSnapshot;
    try {
      before = await snapshot();
    } catch (error) {
      quarantineFatal(error);
      throw error;
    }
    signal?.throwIfAborted();
    let response: CLIResult | undefined;
    let queryFailure: unknown;
    let queryFailed = false;
    let unchangedAfterQuery = false;
    try {
      response = await execute('pipeline', input.args, options);
      const result = parseRdcNativeResult(response, undefined, 'rd.pipeline.get_state');
      if (
        !isDeepStrictEqual(
          parseRdcProcessIdentity((result.meta as Record<string, unknown> | undefined)?.process_identity),
          before.processIdentity,
        )
      ) {
        throw new AppError('RDC_PROBE_OWNER', 'pipeline result came from a different native process.');
      }
    } catch (error) {
      queryFailed = true;
      queryFailure = error;
    }

    if (quarantineFatal(queryFailure)) throw queryFailure;

    try {
      const after = await snapshot();
      if (!sameReplay(before, after)) throw new Error('replay identity or replacements changed');
      unchangedAfterQuery = after.eventId === before.eventId;
      if (after.eventId !== before.eventId) {
        const args = { session_id: before.replaySessionId, event_id: before.eventId };
        const restored = await execute(
          'call',
          ['rd.event.set_active', '--args-json', JSON.stringify(args), '--daemon-context', lease.contextId],
          options,
        );
        const result = parseRdcNativeResult(restored, undefined, 'rd.event.set_active');
        if (result.data.active_event_id !== before.eventId)
          throw new Error('native event restoration was not confirmed');
        const verified = await snapshot();
        if (!sameReplay(before, verified) || verified.eventId !== before.eventId)
          throw new Error('restored replay state differs');
      }
    } catch (error) {
      quarantineRdcContext(
        lease.ownerSessionId,
        lease.version,
        'Pipeline probe could not prove restoration of the owning replay.',
        {
          operation: 'rd.pipeline.get_state',
          argsFingerprint: rdcDigest(input.args),
          code: 'RDC_PROBE_RESTORE_UNCONFIRMED',
        },
      );
      throw new AppError('RDC_PROBE_RESTORE_UNCONFIRMED', error instanceof Error ? error.message : String(error), {
        cause: error,
      });
    }
    if (queryFailed) {
      if (!(queryFailure instanceof RdcNativeFailure && queryFailure.effectsNotAttempted && unchangedAfterQuery)) {
        const code =
          queryFailure instanceof RdcNativeFailure ? queryFailure.nativeError.code : 'RDC_PROBE_QUERY_FAILED';
        quarantineRdcContext(
          lease.ownerSessionId,
          lease.version,
          'Pipeline probe failed without a proven unchanged replay.',
          { operation: 'rd.pipeline.get_state', argsFingerprint: rdcDigest(input.args), code },
        );
      }
      throw queryFailure;
    }
    return response!;
  });
}

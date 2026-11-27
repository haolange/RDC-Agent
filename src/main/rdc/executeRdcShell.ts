import { allowsNativeRdcExecution } from '@shared/constants/toolAccess';
import { AppError } from '@shared/errors/appError';
import {
  assertRdcBindingOwnership,
  authorizeRdcOperation,
  isMainOwnedRdcIdentityKey,
  rdcCapabilityPolicy,
  rdcCatalogCapabilitySummary,
  rdcOperationCapability,
} from './RdcOperationPolicy';
import { operationFingerprint, rdcDigest } from './RdcOperationCatalog';
import { isUnchangedShaderResult, validateExecutionEvidence, verifyRollbackIdentity } from './RdcValidatedEvidence';
import { runRdcOperation } from './RdcOperationCoordinator';
import { assertRdcDiscovery, RdcShellInputSchema, type RdcShellInput } from './RdcShellInput';
import { assertRdcContextLeaseOwnership, registerRdcFault } from './RdcRuntimeContextRegistry';
import { rdcCliInvokerService } from './RdcCliInvokerService';
import {
  modelVisibleRdcFailureDetails,
  parseRdcNativeResult,
  rdcFaultCode,
  RdcNativeFailure,
} from './RdcNativeProtocol';
import { rdcExecutionReceipts } from './RdcExecutionReceipts';
import { rdcInvocationRecord } from './RdcInvocationRecord';
import { parseRdcProcessIdentity } from './RdcProcessIdentity';
import { rdcFailureQuarantines, type RdcCallPhase } from './rdcQuarantineDecision';
import type { AgentToolResult, ToolExecutionContext } from '../agent-runtime/agent/AgentTool';
import type { RdcOperationDefinition } from './RdcOperationCatalog';
import type { RdcCliInvokerSettings } from '@shared/types/settings';
import type { RdcCancellation, RdcOperationFrame } from './RdcOperationWatcher';

/** The owning lease, its context and its replay/capture identity are still the ones this call was admitted with. */
function ownsFrozenReplay(
  scope: { sessionId: string; projectId: string },
  lease: { version: number; contextId: string; runtimeContext: { replaySessionId?: string } },
  frozenCaptureId: string | undefined,
): boolean {
  const current = assertRdcContextLeaseOwnership(scope);
  return (
    current?.version === lease.version &&
    current.contextId === lease.contextId &&
    current.runtimeContext.replaySessionId === lease.runtimeContext.replaySessionId &&
    current.runtimeContext.captureFileId === frozenCaptureId
  );
}

/** Why the lease is quarantined; a cancelled operation names what RDC-Tool's cancel receipt said. */
function uncertainOutcomeReason(
  signal: AbortSignal | undefined,
  cancellation: RdcCancellation | undefined,
  error: unknown,
): string {
  const recover = 'inspect and recover through the capture lifecycle before further execution.';
  // A stuck or lost worker keeps the stack dump RDC-Tool wrote before stopping it.
  const stack = error instanceof RdcNativeFailure ? error.processFailure?.stack_log?.path : undefined;
  if (!signal?.aborted)
    return `Native operation outcome is uncertain${stack ? ` (worker stack log: ${stack})` : ''}; ${recover}`;
  const exit = cancellation?.status === 'settled' ? cancellation.workerExit : undefined;
  const receipt = !cancellation
    ? 'no cancel receipt'
    : cancellation.status === 'unconfirmed'
      ? `cancel receipt unavailable: ${cancellation.reason}`
      : `RDC-Tool ${cancellation.outcome}${exit ? `; worker ${exit.exitConfirmed ? 'exit confirmed' : 'exit unconfirmed'}` : ''}`;
  return `Native operation was cancelled (${receipt}); ${recover}`;
}

function callableRdcDefinition(definition: RdcOperationDefinition): Record<string, unknown> {
  const inputSchema = structuredClone(definition.input_schema);
  const properties = inputSchema.properties as Record<string, unknown> | undefined;
  const hostSuppliedIdentity = Object.keys(properties ?? {}).filter(isMainOwnedRdcIdentityKey);
  for (const key of hostSuppliedIdentity) delete properties?.[key];
  if (Array.isArray(inputSchema.required)) {
    inputSchema.required = inputSchema.required.filter(
      (key): key is string => typeof key === 'string' && !isMainOwnedRdcIdentityKey(key),
    );
  }
  return {
    name: definition.name,
    description: definition.description,
    scope: definition.scope,
    effects: definition.effects,
    evidence_kind: definition.evidence_kind,
    path_inputs: definition.path_inputs,
    input_schema: inputSchema,
    host_supplied_identity: hostSuppliedIdentity,
    returns_raw: definition.returns_raw,
  };
}

function searchRdcDefinitions(definitions: readonly RdcOperationDefinition[], query: string, limit: number) {
  const terms = [...new Set(query.toLowerCase().split(/\s+/).filter(Boolean))];
  const matches = definitions
    .map((item, index) => {
      const name = item.name.toLowerCase();
      const description = item.description.toLowerCase();
      const schema = item.input_schema.properties;
      const parameterNames =
        schema && typeof schema === 'object' && !Array.isArray(schema) ? Object.keys(schema).join(' ') : '';
      const supportingText = [
        item.namespace,
        item.group,
        item.parameter_raw,
        item.returns_raw,
        parameterNames,
        item.evidence_kind,
      ]
        .filter((value): value is string => typeof value === 'string')
        .join(' ')
        .toLowerCase();
      let score = 0;
      let matchedTerms = 0;
      for (const term of terms) {
        if (name.includes(term)) {
          score += 12;
          matchedTerms += 1;
        } else if (description.includes(term)) {
          score += 4;
          matchedTerms += 1;
        } else if (supportingText.includes(term)) {
          score += 1;
          matchedTerms += 1;
        }
      }
      if (!matchedTerms) return null;
      if (name === query.toLowerCase()) score += 100;
      score += matchedTerms * matchedTerms;
      return { item, index, score };
    })
    .filter((entry): entry is { item: RdcOperationDefinition; index: number; score: number } => entry !== null)
    .sort((left, right) => right.score - left.score || left.index - right.index);
  return {
    matches: matches.slice(0, limit).map(({ item }) => ({
      name: item.name,
      description: item.description,
      scope: item.scope,
      effects: item.effects,
      evidence_kind: item.evidence_kind,
    })),
    total: matches.length,
    truncated: matches.length > limit,
  };
}

type ReplayState = { process: ReturnType<typeof parseRdcProcessIdentity>; replacements: string };
type PreservationBasis = 'pure-read' | 'operation-not-run' | 'result-proven' | 'native-proof';

/**
 * Whether a failed call leaves the owning lease usable, and on what basis: a failure that by its kind cannot have
 * changed the replay, RDC-Tool's no-effect proof, a verified restoration of the original event, or a truncated
 * buffer read whose replay is verified. Anything else is quarantined by the caller.
 */
async function qualifyRdcFailure(input: {
  error: unknown;
  phase: RdcCallPhase;
  definition: RdcOperationDefinition;
  args: Record<string, unknown>;
  toolCallId: string;
  cli: RdcCliInvokerSettings;
  aborted: boolean;
  cancellation: RdcCancellation | undefined;
  scope: { sessionId: string; projectId: string };
  lease: { version: number; contextId: string; runtimeContext: { replaySessionId?: string } };
  frozenCaptureId: string | undefined;
  originalEvent: number | undefined;
  originalReplayState: ReplayState | null;
  truncatedBufferRead: boolean;
  readReplayEvent: () => Promise<number>;
  currentReplayState: () => ReplayState | null;
}): Promise<{ retained: boolean; basis?: PreservationBasis }> {
  const { error, phase, definition, scope, lease, originalEvent, originalReplayState } = input;
  const owns = () => {
    try {
      return ownsFrozenReplay(scope, lease, input.frozenCaptureId);
    } catch {
      return false;
    }
  };
  const replayUnchanged = !rdcFailureQuarantines({
    phase,
    definition,
    error,
    aborted: input.aborted,
    cancellation: input.cancellation,
  });
  if (replayUnchanged && owns())
    return {
      retained: true,
      basis: phase === 'settled' ? 'result-proven' : phase === 'preflight' ? 'operation-not-run' : 'pure-read',
    };
  if (input.aborted || !(error instanceof Error)) return { retained: false };
  const native = error instanceof RdcNativeFailure ? error : null;
  if (native?.resultKind === definition.name && native.effectsNotAttempted && owns())
    return { retained: true, basis: 'native-proof' };
  const sameReplayState = () => {
    const current = input.currentReplayState();
    return current !== null && originalReplayState !== null && rdcDigest(current) === rdcDigest(originalReplayState);
  };
  const restoration =
    (definition.name === 'rd.export.screenshot' ? native?.screenshotTargetRestoration : null) ??
    native?.inspectionRestoration;
  if (
    restoration &&
    originalEvent !== undefined &&
    originalEvent > 0 &&
    restoration.eventId === originalEvent &&
    restoration.contextId === lease.contextId &&
    restoration.sessionId === lease.runtimeContext.replaySessionId &&
    originalReplayState
  ) {
    try {
      if (owns() && (await input.readReplayEvent()) === originalEvent && sameReplayState())
        return { retained: true, basis: 'native-proof' };
    } catch {
      /* An unverified restoration remains quarantined. */
    }
  }
  if (!input.truncatedBufferRead || !originalReplayState) return { retained: false };
  try {
    const event = await input.readReplayEvent();
    if (!owns() || !sameReplayState() || (event !== originalEvent && event !== input.args.event_id))
      return { retained: false };
    const { rdcSessionService } = await import('./RdcSessionService');
    await rdcSessionService.observeAgentOperation(scope, definition.name, input.toolCallId, input.cli, true);
    const observed = assertRdcContextLeaseOwnership(scope);
    if (observed?.version !== lease.version || observed.contextId !== lease.contextId) return { retained: false };
    error.message += ` Replay verified at event ${event}; select a reflection slot.`;
    return { retained: true, basis: 'native-proof' };
  } catch {
    return { retained: false };
  }
}

/** The main-qualified failure the model and UI receive: native details apart from what main verified. */
function qualifiedNativeFailure(
  error: RdcNativeFailure,
  input: {
    operation: string;
    preservation: { retained: boolean; basis?: PreservationBasis };
    replayIdentity: Record<string, unknown>;
    invocation: ReturnType<typeof rdcInvocationRecord> | undefined;
  },
): AgentToolResult {
  const { retained, basis } = input.preservation;
  const proof: Record<string, unknown> = {};
  if (retained) {
    if (error.effectsNotAttempted) Object.assign(proof, { effects_attempted: false, context_preserved: true });
    const restored = error.screenshotTargetRestoration ?? error.inspectionRestoration;
    if (restored) Object.assign(proof, { replay_state_restored: true, restored_event_id: restored.eventId });
  }
  const nativeDetails = error.nativeError.details && modelVisibleRdcFailureDetails(error.nativeError.details);
  const details = {
    ok: false,
    source: 'main-qualified-native-failure',
    operation: input.operation,
    exitCode: error.nativeError.exitCode,
    nativeFailure: {
      code: error.nativeError.code,
      category: error.nativeError.category,
      resultKind: error.resultKind,
      message: error.message,
      proof,
      ...(nativeDetails
        ? { details: nativeDetails.value, ...(nativeDetails.redacted ? { detailsRedacted: true } : {}) }
        : {}),
    },
    mainValidation: {
      preservationVerified: retained,
      leaseState: retained ? 'retained' : 'quarantined',
      ...(basis && basis !== 'native-proof' ? { basis } : {}),
    },
    rdcExecutionIdentity: input.replayIdentity,
    invocation: input.invocation,
  };
  return { isError: true, content: [{ type: 'text', text: JSON.stringify(details) }], details };
}

export async function executeRdcShell(
  raw: RdcShellInput,
  toolCallId: string,
  signal: AbortSignal | undefined,
  context?: ToolExecutionContext,
  onProgress?: (frame: RdcOperationFrame) => void,
): Promise<
  AgentToolResult<{
    operation: string;
    exitCode: number;
    receipt?: import('@shared/types/renderdocInvestigation').InvestigationContentRef;
  }>
> {
  const input = RdcShellInputSchema.parse(raw);
  signal?.throwIfAborted();
  if (
    !context ||
    !allowsNativeRdcExecution(context) ||
    context.excludeRdcLeaseTools ||
    !context.sessionId ||
    !context.projectId ||
    !context.turnId
  ) {
    throw new AppError(
      'RDC_EXECUTION_DENIED',
      'native RDC execution requires a full access ceiling and the owning turn.',
    );
  }
  const lease = assertRdcBindingOwnership(context);
  const cli = context.rdcBinding!.cli;
  const identity = context.rdcBinding!.identity!;
  if ('discovery' in input) {
    const binding = context.rdcBinding!;
    if (operationFingerprint(binding.definitions) !== binding.definitionsFingerprint)
      throw new AppError('RDC_EXECUTION_DENIED', 'invalid frozen catalog.');
    const request = input.discovery;
    assertRdcDiscovery(request, binding);
    let data: unknown;
    if (request.kind === 'describe') {
      const definition = binding.definitions.find((item) => item.name === request.operation) as
        RdcOperationDefinition | undefined;
      data = callableRdcDefinition(definition!);
    } else if (request.kind === 'list') {
      const offset = request.cursor?.offset ?? 0;
      const definitions = binding.definitions as readonly RdcOperationDefinition[];
      const end = Math.min(offset + request.limit, definitions.length);
      data = {
        total: definitions.length,
        offset,
        truncated: end < definitions.length,
        next: end < definitions.length ? { offset: end, fingerprint: binding.definitionsFingerprint } : null,
        policy: rdcCapabilityPolicy(),
        capabilitySummary: rdcCatalogCapabilitySummary(definitions),
        operations: definitions.slice(offset, end).map((item) => ({
          name: item.name,
          scope: item.scope,
          effects: item.effects,
          evidence_kind: item.evidence_kind,
          capabilityAdmission: rdcOperationCapability(item),
        })),
      };
    } else {
      data = searchRdcDefinitions(
        binding.definitions as readonly RdcOperationDefinition[],
        request.query,
        request.limit,
      );
    }
    return {
      content: [{ type: 'text', text: JSON.stringify({ fingerprint: binding.definitionsFingerprint, data }) }],
      details: { operation: `rdc_tool.tools.${request.kind}`, exitCode: 0 },
    };
  }
  const sessionId = context.sessionId;
  const projectId = context.projectId;
  const turnId = context.turnId;
  const replaySessionId = lease.runtimeContext.replaySessionId!;
  const frozenCaptureId = identity.runtimeContext?.captureFileId;
  if (
    frozenCaptureId !== lease.runtimeContext.captureFileId ||
    identity.runtimeContext?.replaySessionId !== replaySessionId
  ) {
    throw new AppError('RDC_EXECUTION_DENIED', 'capture/replay identity changed since prepareTurn.');
  }
  const { definition, args } = authorizeRdcOperation(
    input.operation,
    input.args,
    context,
    replaySessionId,
    frozenCaptureId,
  );
  if (input.experimentId && !definition.evidence_kind)
    throw new AppError(
      'RDC_EVIDENCE_INVALID',
      `${input.operation} has no supported evidence capability; no native operation was executed. ` +
        'Discover and describe a compatible measurement/intervention/rollback operation in the frozen catalog before requesting an experiment receipt. ' +
        'Ordinary tool output cannot replace the returned receipt.uri/expectedHash.',
    );
  verifyRollbackIdentity(definition, args, lease.contextId, input.experimentId);
  // Establish durable signing capability before a potentially mutating call.
  if (input.experimentId) rdcExecutionReceipts.prepare();
  return runRdcOperation(lease.contextId, async () => {
    signal?.throwIfAborted();
    const queuedLease = assertRdcContextLeaseOwnership({ sessionId, projectId });
    if (!queuedLease || queuedLease.version !== lease.version || queuedLease.contextId !== lease.contextId) {
      throw new AppError('RDC_EXECUTION_DENIED', 'binding changed while queued.');
    }
    const startedAt = Date.now();
    let lastInvocation: ReturnType<typeof rdcInvocationRecord> | undefined;
    // Set by readReplayEvent on every replay read.
    let lastReplayState = null as ReplayState | null;
    const verifyTruncatedBufferRead =
      input.operation === 'rd.pipeline.get_constant_buffers' &&
      args.include_contents === true &&
      definition.effects.length === 1 &&
      definition.effects[0] === 'replay_position';
    let truncatedBufferRead = false;
    let phase: RdcCallPhase = 'preflight';
    // The receipt `daemon cancel` settled the operation with, when the turn was cancelled while it ran.
    let cancellation: RdcCancellation | undefined;
    const readReplayEvent = async (): Promise<number> => {
      lastInvocation = rdcInvocationRecord('rd.session.get_context', {});
      const response = await rdcCliInvokerService.executeCLI(
        'call',
        ['rd.session.get_context', '--args-json', '{}', '--daemon-context', lease.contextId],
        { abortSignal: signal, contextId: lease.contextId, settings: cli },
      );
      if (response.cancellation) cancellation = response.cancellation;
      const snapshot = parseRdcNativeResult(response, undefined, 'rd.session.get_context');
      const runtime = snapshot.data.runtime as Record<string, unknown> | undefined;
      if (
        snapshot.data.context_id !== lease.contextId ||
        snapshot.data.current_session_id !== replaySessionId ||
        !Number.isSafeInteger(runtime?.active_event_id) ||
        Number(runtime?.active_event_id) < 0
      ) {
        throw new AppError('RDC_CLI_PROTOCOL', 'cannot verify temporary replay identity and position.');
      }
      lastReplayState = null;
      const sessions = snapshot.data.sessions;
      const selected = Array.isArray(sessions)
        ? (sessions.find((item) => item && typeof item === 'object' && item.session_id === replaySessionId) as
            Record<string, unknown> | undefined)
        : undefined;
      if (selected && selected.capture_file_id === frozenCaptureId && Array.isArray(selected.shader_replacements)) {
        try {
          lastReplayState = {
            process: parseRdcProcessIdentity((snapshot.meta as Record<string, unknown> | undefined)?.process_identity),
            replacements: rdcDigest(selected.shader_replacements),
          };
        } catch {
          /* Missing native identity cannot prove restoration. */
        }
      }
      return Number(runtime!.active_event_id);
    };
    let originalEvent: number | undefined;
    let originalReplayState: typeof lastReplayState = null;
    try {
      const temporaryReplayRead = definition.effects.includes('replay_position_temporary');
      originalEvent =
        temporaryReplayRead ||
        verifyTruncatedBufferRead ||
        input.operation === 'rd.export.screenshot' ||
        input.operation === 'rd.shader.get_source' ||
        input.operation === 'rd.shader.get_constant_buffer_contents' ||
        input.operation === 'rd.texture.get_pixel_history' ||
        [
          'rd.texture.get_data',
          'rd.texture.get_region_values',
          'rd.texture.get_histogram',
          'rd.texture.compute_stats',
          'rd.texture.diff',
        ].includes(input.operation) ||
        input.operation === 'rd.shader.debug_start' ||
        input.operation === 'rd.shader.edit_and_replace'
          ? await readReplayEvent()
          : undefined;
      originalReplayState = lastReplayState;
      lastInvocation = rdcInvocationRecord(input.operation, args);
      phase = 'native';
      const result = await rdcCliInvokerService.executeCLI(
        'call',
        [input.operation, '--args-json', JSON.stringify(args), '--daemon-context', lease.contextId],
        { abortSignal: signal, contextId: lease.contextId, settings: cli, onProgress },
      );
      cancellation = result.cancellation;
      truncatedBufferRead = verifyTruncatedBufferRead && result.exitCode === 0 && result.stdoutTruncated === true;
      signal?.throwIfAborted();
      const payload = parseRdcNativeResult(result, undefined, input.operation);
      phase = 'verifying';
      if (
        payload.result_kind !== input.operation ||
        (payload.data.context_id !== undefined && payload.data.context_id !== lease.contextId) ||
        (payload.data.session_id !== undefined && payload.data.session_id !== replaySessionId) ||
        (definition.scope === 'capture' && payload.data.capture_file_id !== frozenCaptureId)
      ) {
        throw new AppError('RDC_CLI_PROTOCOL', 'operation or replay identity mismatch; no receipt issued.');
      }
      const after = assertRdcContextLeaseOwnership({ sessionId: sessionId, projectId: projectId });
      if (!after || after.version !== lease.version || after.contextId !== lease.contextId) {
        throw new AppError(
          'RDC_EXECUTION_DENIED',
          'replay ownership changed during execution; inspect state before retrying.',
        );
      }
      if (
        temporaryReplayRead &&
        originalEvent !== undefined &&
        (payload.data.replay_state_restored !== true ||
          payload.data.restored_event_id !== originalEvent ||
          (await readReplayEvent()) !== originalEvent)
      ) {
        throw new AppError('RDC_CLI_PROTOCOL', 'temporary replay operation did not prove restoration.');
      }
      phase = 'settled';
      const unchangedShader = isUnchangedShaderResult(definition, payload.data);
      const evidence =
        input.experimentId && !unchangedShader
          ? await validateExecutionEvidence(
              definition,
              args,
              payload.data,
              context,
              lease.contextId,
              input.experimentId,
            )
          : null;
      signal?.throwIfAborted();
      const receipt =
        input.experimentId && evidence
          ? rdcExecutionReceipts.write(
              {
                sessionId: sessionId,
                projectId: projectId,
                turnId: turnId,
                toolCallId,
                experimentId: input.experimentId,
                contextId: lease.contextId,
                leaseVersion: lease.version,
                replaySessionId: replaySessionId,
                operation: input.operation,
                definitionsFingerprint: context.rdcBinding!.definitionsFingerprint,
                processIdentity: parseRdcProcessIdentity(
                  (payload.meta as Record<string, unknown> | undefined)?.process_identity,
                ),
                evidence,
                args,
                argsFingerprint: rdcDigest(args),
                result: payload.data,
                resultHash: rdcDigest(payload.data),
                startedAt,
                completedAt: Date.now(),
                exitCode: 0,
              },
              signal,
            )
          : undefined;
      // Perf dispatch awaits all sampling before returning; observe only after its completed result and receipt.
      if (definition.effects.some((effect) => ['replay_position', 'shader_replacement'].includes(effect))) {
        const { rdcSessionService } = await import('./RdcSessionService');
        await rdcSessionService.observeAgentOperation(
          { sessionId: sessionId, projectId: projectId },
          input.operation,
          toolCallId,
          cli,
          true,
        );
      }
      const rdcExecutionIdentity = {
        productSessionId: sessionId,
        contextId: lease.contextId,
        replaySessionId,
        captureFileId: frozenCaptureId,
      };
      const invocation = rdcInvocationRecord(input.operation, args);
      const executionEvidence = unchangedShader
        ? {
            status: 'not-executed',
            reason: 'native-shader-noop',
            receiptIssued: false,
            message:
              'Native status=noop: no build or shader replacement was performed. No intervention receipt was issued.',
          }
        : undefined;
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ result: payload, receipt, executionEvidence, rdcExecutionIdentity, invocation }),
          },
        ],
        details: {
          operation: input.operation,
          exitCode: 0,
          receipt,
          rdcExecutionIdentity,
          invocation,
          executionEvidence,
        },
      };
    } catch (error) {
      // Restoration checks read the replay again; the failure keeps the call that actually failed.
      const failedInvocation = lastInvocation;
      const replayIdentity = {
        productSessionId: sessionId,
        contextId: lease.contextId,
        replaySessionId,
        captureFileId: frozenCaptureId,
      };
      const preservation = await qualifyRdcFailure({
        error,
        phase,
        definition,
        args,
        toolCallId,
        cli,
        aborted: signal?.aborted === true,
        cancellation,
        scope: { sessionId, projectId },
        lease,
        frozenCaptureId,
        originalEvent,
        originalReplayState,
        truncatedBufferRead,
        readReplayEvent,
        currentReplayState: () => lastReplayState,
      });
      if (!preservation.retained) {
        registerRdcFault({
          sessionId,
          expectedVersion: lease.version,
          operation: input.operation,
          nativeArgs: args,
          cause: signal?.aborted ? 'RDC_OPERATION_CANCELLED' : rdcFaultCode(error),
          reason: uncertainOutcomeReason(signal, cancellation, error),
        });
      }
      if (error instanceof RdcNativeFailure)
        error.deliveryResult = qualifiedNativeFailure(error, {
          operation: input.operation,
          preservation,
          replayIdentity,
          invocation: failedInvocation,
        });
      throw error;
    }
  });
}

import { z } from 'zod';
import { AppError } from '@shared/errors/appError';
import { redactCredentialLikeText } from '../runtime/secretRedaction';
import { noteRdcProcessIdentity } from './RdcProcessIdentity';
import type { ErrorCode } from '@shared/errors/errorCodes';
import type { CLIResult } from '../tools/ShellInvocationService';
import type { AgentToolResult } from '../agent-runtime/agent/AgentTool';

/** Preserve native diagnostics while keeping credentials and private owner paths out of model results. */
export function modelVisibleRdcFailureDetails(details: Record<string, unknown>): {
  value: Record<string, unknown>;
  redacted: boolean;
} {
  let redacted = false;
  const visit = (value: unknown): unknown => {
    if (typeof value === 'string') {
      const safe = redactCredentialLikeText(value);
      if (safe !== value) redacted = true;
      return safe;
    }
    if (Array.isArray(value)) return value.map(visit);
    if (value === null || typeof value !== 'object') return value;
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (/(?:password|secret|token|authorization|credential|api[_-]?key|cookie)|^(?:private|state)_path$/i.test(key)) {
        redacted = true;
      } else {
        result[key] = visit(child);
      }
    }
    return result;
  };
  return { value: visit(details) as Record<string, unknown>, redacted };
}

/** RDC-Tool's success envelope; fields this app does not read pass through for its callers. */
const RdcNativeEnvelopeSchema = z
  .object({
    ok: z.literal(true),
    result_kind: z.string().min(1),
    data: z.record(z.string(), z.unknown()),
  })
  .passthrough();
export type RdcNativeEnvelope = z.infer<typeof RdcNativeEnvelopeSchema>;

/** RDC-Tool's failure envelope; `details` is native diagnostics, read field by field below. */
const RdcNativeFailureEnvelopeSchema = z
  .object({
    ok: z.literal(false),
    schema_version: z.unknown().optional(),
    result_kind: z.unknown().optional(),
    error: z
      .object({
        code: z.string(),
        message: z.string(),
        category: z.unknown().optional(),
        details: z.unknown().optional(),
      })
      .passthrough(),
  })
  .passthrough();
const RdcNativeObjectSchema = z.record(z.string(), z.unknown());

/**
 * Failures of the process that runs an operation rather than of the operation itself (RDC-Tool public contract,
 * execution budget): a stuck or lost worker, one that could not start, a cancelled request, and a CLI that lost its
 * daemon or heard nothing from it. Each carries its own Agent code so callers and copy can tell them apart.
 */
const RDC_PROCESS_FAILURE_CODES = {
  worker_stuck: 'RDC_OPERATION_STUCK',
  worker_lost: 'RDC_WORKER_LOST',
  worker_request_failed: 'RDC_WORKER_LOST',
  worker_unavailable: 'RDC_WORKER_UNAVAILABLE',
  operation_cancelled: 'RDC_OPERATION_CANCELLED',
  daemon_lost: 'RDC_DAEMON_LOST',
  daemon_unresponsive: 'RDC_DAEMON_UNRESPONSIVE',
} as const satisfies Record<string, ErrorCode>;
type RdcProcessFailureCode = keyof typeof RDC_PROCESS_FAILURE_CODES;
const isProcessFailureCode = (code: string): code is RdcProcessFailureCode =>
  Object.hasOwn(RDC_PROCESS_FAILURE_CODES, code);

const ProcessIdentityDetailSchema = z.object({ pid: z.number().nullable(), start_generation: z.string().nullable() });
/** The documented details of a process failure; fields RDC-Tool adds later pass through untouched. */
const RdcProcessFailureDetailsSchema = z
  .object({
    failure_stage: z.string(),
    reason: z.string(),
    outcome: z.enum(['unknown', 'not_started', 'cancelled']),
    request_id: z.string().optional(),
    trace_id: z.string().optional(),
    operation: z.string().optional(),
    worker: ProcessIdentityDetailSchema.optional(),
    worker_exit_confirmed: z.boolean().optional(),
    replay_requires_restart: z.boolean().optional(),
    stack_log: z.object({ path: z.string(), tail: z.string() }).optional(),
    last_progress: z
      .object({ stage: z.string().nullable(), native_call: z.unknown(), at_ms: z.number().nullable() })
      .optional(),
    no_progress_ms: z.number().optional(),
    daemon: ProcessIdentityDetailSchema.optional(),
    daemon_exit_confirmed: z.boolean().optional(),
    heartbeat_gap_ms: z.number().optional(),
  })
  .passthrough();
export type RdcProcessFailure = z.infer<typeof RdcProcessFailureDetailsSchema> & { code: RdcProcessFailureCode };

export class RdcNativeFailure extends AppError {
  /** Bound only after the owning execution path finishes its existing safety checks. */
  deliveryResult?: AgentToolResult;
  /** Set when the failure is the operation's process (worker, daemon, cancellation) and its details parse. */
  readonly processFailure: RdcProcessFailure | null;
  constructor(
    message: string,
    readonly resultKind: string | null,
    readonly effectsNotAttempted: boolean,
    readonly nativeError: {
      code: string;
      category: string | null;
      exitCode: number;
      details?: Record<string, unknown>;
    },
    readonly screenshotTargetRestoration: { contextId: string; sessionId: string; eventId: number } | null = null,
    readonly inspectionRestoration: { contextId: string; sessionId: string; eventId: number } | null = null,
  ) {
    const processCode = isProcessFailureCode(nativeError.code) ? nativeError.code : null;
    const parsed = processCode ? RdcProcessFailureDetailsSchema.safeParse(nativeError.details) : null;
    const processFailure = processCode && parsed?.success ? { ...parsed.data, code: processCode } : null;
    const operation = processFailure?.operation ?? resultKind ?? 'rdc';
    super(
      processCode ? RDC_PROCESS_FAILURE_CODES[processCode] : 'RDC_NATIVE_FAILURE',
      message,
      processCode === 'daemon_unresponsive'
        ? { params: { operation, seconds: Math.round((processFailure?.heartbeat_gap_ms ?? 0) / 1000) } }
        : processCode
          ? { params: { operation } }
          : {},
    );
    this.name = 'RdcNativeFailure';
    this.processFailure = processFailure;
  }
}

/**
 * What the model may read beyond the native code and message. Only the owner-unavailable infrastructure failure exposes
 * its bounded recovery fields; arbitrary native details (including state paths and credentials) stay internal. An input
 * attachment the backend cannot inspect gets one fixed host note, because a retry returns the same result.
 */
function failureGuidance(
  failure: { code: string; category?: unknown },
  details: Record<string, unknown> | null,
  inputAttachmentUnsupported: boolean,
): string {
  const ownerGuidance =
    failure.code === 'daemon_owner_unavailable' && failure.category === 'runtime'
      ? ['reason', 'recovery_hint'].flatMap((key) => {
          const value = details?.[key];
          return typeof value === 'string' &&
            value.trim().length > 0 &&
            value.length <= 512 &&
            !/[\u0000-\u001f\u007f]/u.test(value)
            ? [`${key}: ${value.trim()}`]
            : [];
        })
      : [];
  const hostGuidance = inputAttachmentUnsupported
    ? [
        'host: this backend cannot inspect the input attachment and a retry returns the same result; compare region values before and after the event, read the producing pass output, or read another texture',
      ]
    : [];
  const guidance = [...ownerGuidance, ...hostGuidance];
  return guidance.length ? ` (${guidance.join('; ')})` : '';
}

/** The failure is the operation's own worker, daemon or cancellation, whether or not its details parse. */
export function isRdcProcessFailure(error: RdcNativeFailure): boolean {
  return isProcessFailureCode(error.nativeError.code);
}

/**
 * Fail before any lease/experiment state is committed. Never surface binary stdout. Every RDC result is parsed here, so
 * a success that names its daemon context (expected or reported) also records the process identity that served it.
 */
export function parseRdcNativeResult(
  result: CLIResult,
  expectedContext?: string,
  expectedKind?: string,
): RdcNativeEnvelope {
  if (result.stdoutTruncated) {
    throw new AppError(
      'RDC_CLI_OUTPUT_TRUNCATED',
      `native result exceeded the bounded stdout buffer (${result.stdoutByteLength ?? 'unknown'} bytes).`,
    );
  }
  if (result.exitCode !== 0 && !result.stdout.trim()) {
    throw new AppError('RDC_CLI_FAILED', `native rdc exited with code ${result.exitCode} without a result.`);
  }
  let value: unknown;
  try {
    value = JSON.parse(result.stdout);
  } catch {
    const bytes = result.stdoutByteLength ?? Buffer.byteLength(result.stdout, 'utf8');
    const prefix = result.stdout.trimStart().startsWith('{') ? 'json_object' : 'other';
    throw new AppError(
      'RDC_CLI_PROTOCOL',
      `expected a canonical JSON result (stdoutBytes=${bytes}, prefix=${prefix}).`,
    );
  }
  const object = RdcNativeObjectSchema.safeParse(value);
  if (!object.success) {
    throw new AppError('RDC_CLI_PROTOCOL', 'expected a JSON object.');
  }
  const failed = RdcNativeFailureEnvelopeSchema.safeParse(value);
  if (failed.success) {
    const envelope = failed.data;
    const failure = envelope.error;
    const nativeDetails = RdcNativeObjectSchema.safeParse(failure.details);
    const details = nativeDetails.success ? nativeDetails.data : null;
    const recoveryCode =
      failure.code === 'replacement_revert_recovery_failed' ? details?.recovery_error_code : undefined;
    const cleanupCode = failure.code === 'context_cleanup_failed' ? details?.cleanup_reason_code : undefined;
    const detailCode = recoveryCode ?? cleanupCode;
    const detailLabel = recoveryCode ? 'recovery' : 'cleanup';
    const suffix =
      typeof detailCode === 'string' && /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(detailCode)
        ? ` (${detailLabel}: ${detailCode})`
        : '';
    const resultKind = typeof envelope.result_kind === 'string' ? envelope.result_kind : null;
    const canonicalFailure =
      envelope.schema_version === '3.0.0' &&
      result.exitCode !== 0 &&
      resultKind !== null &&
      resultKind === expectedKind;
    const effectsNotAttempted =
      canonicalFailure &&
      details?.recovery_required !== true &&
      details?.effects_attempted === false &&
      details.context_preserved === true;
    const screenshotTargetRestoration =
      canonicalFailure &&
      details?.recovery_required !== true &&
      resultKind === 'rd.export.screenshot' &&
      details?.failure_stage === 'resolve_visual_target' &&
      details.replay_state_restored === true &&
      details.artifact_write_attempted === false &&
      typeof details.context_id === 'string' &&
      typeof details.session_id === 'string' &&
      Number.isSafeInteger(details.restored_event_id) &&
      Number(details.restored_event_id) > 0
        ? { contextId: details.context_id, sessionId: details.session_id, eventId: Number(details.restored_event_id) }
        : null;
    // Pixel history and shader debug (which replays through pixel history) cannot inspect an input attachment.
    const inputAttachmentUnsupported =
      ['rd.texture.get_pixel_history', 'rd.shader.debug_start'].includes(resultKind!) &&
      details?.failure_stage === 'validate_input_attachment';
    const knownInspectionFailure =
      inputAttachmentUnsupported ||
      (resultKind === 'rd.shader.get_source' &&
        details?.failure_stage === 'resolve_binding' &&
        ['stage_unbound', 'shader_id_not_bound'].includes(String(details.failure_reason))) ||
      (resultKind === 'rd.shader.get_constant_buffer_contents' &&
        details?.failure_stage === 'decode_constant_buffer' &&
        ['slot_unavailable', 'reflection_unavailable_without_raw_fallback'].includes(String(details.failure_reason))) ||
      ([
        'rd.texture.get_data',
        'rd.texture.get_region_values',
        'rd.texture.get_histogram',
        'rd.texture.compute_stats',
        'rd.texture.diff',
      ].includes(resultKind!) &&
        details?.failure_stage === 'decode_texture_readback') ||
      (resultKind === 'rd.shader.edit_and_replace' &&
        failure.code === 'shader_patch_op_unsupported_for_encoding' &&
        details?.failure_stage === 'validate_edit_plan' &&
        details.failure_reason === 'source_encoding_not_safely_replaceable' &&
        details.replacement_attempted === false);
    const inspectionRestoration =
      canonicalFailure &&
      details?.recovery_required !== true &&
      knownInspectionFailure &&
      details.replay_state_restored === true &&
      typeof details.context_id === 'string' &&
      typeof details.session_id === 'string' &&
      Number.isSafeInteger(details.restored_event_id) &&
      Number(details.restored_event_id) > 0
        ? { contextId: details.context_id, sessionId: details.session_id, eventId: Number(details.restored_event_id) }
        : null;
    const guidanceSuffix = failureGuidance(failure, details, inputAttachmentUnsupported);
    throw new RdcNativeFailure(
      `RDC_CLI_FAILED: ${failure.code}: ${failure.message}${suffix}${guidanceSuffix}`,
      resultKind,
      effectsNotAttempted,
      {
        code: failure.code,
        category: typeof failure.category === 'string' ? failure.category : null,
        exitCode: result.exitCode,
        ...(details ? { details } : {}),
      },
      screenshotTargetRestoration,
      inspectionRestoration,
    );
  }
  if (result.exitCode !== 0) throw new AppError('RDC_CLI_FAILED', 'native rdc exited with code ' + result.exitCode);
  if (object.data.ok !== true) throw new AppError('RDC_CLI_FAILED', 'native rdc did not report ok:true.');
  const succeeded = RdcNativeEnvelopeSchema.safeParse(value);
  if (!succeeded.success)
    throw new AppError('RDC_CLI_PROTOCOL', `missing result_kind or data: ${z.prettifyError(succeeded.error)}`);
  const envelope = succeeded.data;
  if (expectedKind && envelope.result_kind !== expectedKind)
    throw new AppError('RDC_CLI_PROTOCOL', 'unexpected result_kind.');
  if (expectedContext && envelope.data.context_id !== expectedContext) {
    throw new AppError('RDC_CONTEXT_MISMATCH', 'CLI response does not belong to the owning daemon context.');
  }
  noteServingProcess(envelope, expectedContext);
  return envelope;
}

function noteServingProcess(envelope: RdcNativeEnvelope, expectedContext: string | undefined): void {
  const context = expectedContext ?? envelope.data.context_id;
  if (typeof context === 'string' && context)
    noteRdcProcessIdentity(context, (envelope.meta as Record<string, unknown> | undefined)?.process_identity);
}

/** The observed failure a quarantine records: RDC-Tool's error code, or the leading code of an Agent failure. */
export function rdcFaultCode(error: unknown): string {
  const reported =
    error instanceof RdcNativeFailure
      ? error.nativeError.code
      : error instanceof Error
        ? (/^[A-Z][A-Z0-9_]{0,127}/u.exec(error.message)?.[0] ?? error.name)
        : 'unknown';
  return /^[A-Za-z][A-Za-z0-9_]{0,127}$/u.test(reported) ? reported : 'unknown';
}

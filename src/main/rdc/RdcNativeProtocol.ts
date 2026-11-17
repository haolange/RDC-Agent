import type { CLIResult } from '@shared/types/tool';
import type { AgentToolResult } from '../agent-runtime/agent/AgentTool';

export interface RdcNativeEnvelope {
  ok: true;
  context_id?: string;
  result_kind: string;
  data: Record<string, unknown>;
  [key: string]: unknown;
}

export class RdcNativeFailure extends Error {
  /** Bound only after the owning execution path finishes its existing safety checks. */
  deliveryResult?: AgentToolResult;
  constructor(message: string, readonly resultKind: string | null,
    readonly effectsNotAttempted: boolean,
    readonly nativeError: { code: string; category: string | null; exitCode: number; details?: Record<string, unknown> },
    readonly screenshotTargetRestoration: { contextId: string; sessionId: string; eventId: number } | null = null,
    readonly inspectionRestoration: { contextId: string; sessionId: string; eventId: number } | null = null) {
    super(message);
    this.name = 'RdcNativeFailure';
  }
}

/** Fail before any lease/experiment state is committed. Never surface binary stdout. */
export function parseRdcNativeResult(result: CLIResult, expectedContext?: string, expectedKind?: string): RdcNativeEnvelope {
  if (result.stdoutTruncated) {
    throw new Error(`RDC_CLI_OUTPUT_TRUNCATED: native result exceeded the bounded stdout buffer (${result.stdoutByteLength ?? 'unknown'} bytes).`);
  }
  if (result.exitCode !== 0 && !result.stdout.trim()) {
    throw new Error(`RDC_CLI_FAILED: native rdc exited with code ${result.exitCode} without a result.`);
  }
  let value: unknown;
  try { value = JSON.parse(result.stdout); } catch {
    const bytes = result.stdoutByteLength ?? Buffer.byteLength(result.stdout, 'utf8');
    const prefix = result.stdout.trimStart().startsWith('{') ? 'json_object' : 'other';
    throw new Error(`RDC_CLI_PROTOCOL: expected a canonical JSON result (stdoutBytes=${bytes}, prefix=${prefix}).`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('RDC_CLI_PROTOCOL: expected a JSON object.');
  }
  const envelope = value as Record<string, unknown>;
  if (envelope.ok === false && envelope.error && typeof envelope.error === 'object' && !Array.isArray(envelope.error)) {
    const failure = envelope.error as Record<string, unknown>;
    if (typeof failure.code === 'string' && typeof failure.message === 'string') {
      const details = failure.details && typeof failure.details === 'object' && !Array.isArray(failure.details)
        ? failure.details as Record<string, unknown> : null;
      const recoveryCode = failure.code === 'replacement_revert_recovery_failed' ? details?.recovery_error_code : undefined;
      const cleanupCode = failure.code === 'context_cleanup_failed' ? details?.cleanup_reason_code : undefined;
      const detailCode = recoveryCode ?? cleanupCode;
      const detailLabel = recoveryCode ? 'recovery' : 'cleanup';
      const suffix = typeof detailCode === 'string' && /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(detailCode)
        ? ` (${detailLabel}: ${detailCode})` : '';
      const resultKind = typeof envelope.result_kind === 'string' ? envelope.result_kind : null;
      const canonicalFailure = envelope.schema_version === '3.0.0' && result.exitCode !== 0
        && resultKind !== null && resultKind === expectedKind;
      const effectsNotAttempted = canonicalFailure && details?.recovery_required !== true
        && details?.effects_attempted === false && details?.context_preserved === true;
      const screenshotTargetRestoration = canonicalFailure && details?.recovery_required !== true
        && resultKind === 'rd.export.screenshot' && details?.failure_stage === 'resolve_visual_target'
        && details?.replay_state_restored === true && details?.artifact_write_attempted === false
        && typeof details?.context_id === 'string' && typeof details?.session_id === 'string'
        && Number.isSafeInteger(details?.restored_event_id) && Number(details?.restored_event_id) > 0
        ? { contextId: details.context_id, sessionId: details.session_id, eventId: Number(details.restored_event_id) } : null;
      const knownInspectionFailure = ((resultKind === 'rd.shader.get_source'
        && details?.failure_stage === 'resolve_binding'
        && ['stage_unbound', 'shader_id_not_bound'].includes(String(details?.failure_reason)))
        || (resultKind === 'rd.shader.get_constant_buffer_contents'
          && details?.failure_stage === 'decode_constant_buffer'
          && ['slot_unavailable', 'reflection_unavailable_without_raw_fallback'].includes(String(details?.failure_reason))))
        || (['rd.texture.get_data', 'rd.texture.get_region_values', 'rd.texture.get_histogram',
          'rd.texture.compute_stats', 'rd.texture.diff'].includes(resultKind!)
          && details?.failure_stage === 'decode_texture_readback')
        || (['rd.texture.get_pixel_history', 'rd.shader.debug_start'].includes(resultKind!)
          && details?.failure_stage === 'validate_input_attachment');
      const inspectionRestoration = canonicalFailure && details?.recovery_required !== true && knownInspectionFailure
        && details?.replay_state_restored === true
        && typeof details?.context_id === 'string' && typeof details?.session_id === 'string'
        && Number.isSafeInteger(details?.restored_event_id) && Number(details?.restored_event_id) > 0
        ? { contextId: details.context_id, sessionId: details.session_id, eventId: Number(details.restored_event_id) } : null;
      // Only this infrastructure failure exposes its bounded recovery guidance.
      // Arbitrary native details (including state paths and credentials) stay internal.
      const ownerGuidance = failure.code === 'daemon_owner_unavailable' && failure.category === 'runtime'
        ? ['reason', 'recovery_hint'].flatMap(key => {
          const value = details?.[key];
          return typeof value === 'string' && value.trim().length > 0 && value.length <= 512
            && !/[\u0000-\u001f\u007f]/u.test(value) ? [`${key}: ${value.trim()}`] : [];
        }) : [];
      const guidance = ownerGuidance.length ? ` (${ownerGuidance.join('; ')})` : '';
      throw new RdcNativeFailure(`RDC_CLI_FAILED: ${failure.code}: ${failure.message}${suffix}${guidance}`,
        resultKind, effectsNotAttempted,
        { code: failure.code, category: typeof failure.category === 'string' ? failure.category : null, exitCode: result.exitCode, ...(details ? { details } : {}) },
        screenshotTargetRestoration, inspectionRestoration);
    }
  }
  if (result.exitCode !== 0) throw new Error('RDC_CLI_FAILED: native rdc exited with code ' + result.exitCode);
  if (envelope.ok !== true) throw new Error('RDC_CLI_FAILED: native rdc did not report ok:true.');
  if (typeof envelope.result_kind !== 'string' || !envelope.result_kind
    || !envelope.data || typeof envelope.data !== 'object' || Array.isArray(envelope.data)) {
    throw new Error('RDC_CLI_PROTOCOL: missing result_kind or data.');
  }
  if (expectedKind && envelope.result_kind !== expectedKind) throw new Error('RDC_CLI_PROTOCOL: unexpected result_kind.');
  const responseContext = (envelope.data as Record<string, unknown>).context_id;
  if (expectedContext && responseContext !== expectedContext) {
    throw new Error('RDC_CONTEXT_MISMATCH: CLI response does not belong to the owning daemon context.');
  }
  return envelope as unknown as RdcNativeEnvelope;
}

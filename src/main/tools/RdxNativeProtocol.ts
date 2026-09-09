import type { CLIResult } from '@shared/types/tool';

export interface RdxNativeEnvelope {
  ok: true;
  context_id?: string;
  result_kind: string;
  data: Record<string, unknown>;
  [key: string]: unknown;
}

/** Fail before any lease/experiment state is committed. Never surface binary stdout. */
export function parseRdxNativeResult(result: CLIResult, expectedContext?: string): RdxNativeEnvelope {
  if (result.exitCode !== 0) {
    throw new Error('RDX_CLI_FAILED: native rdx exited with code ' + result.exitCode);
  }
  let value: unknown;
  try { value = JSON.parse(result.stdout); } catch {
    throw new Error('RDX_CLI_PROTOCOL: expected a canonical JSON result.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('RDX_CLI_PROTOCOL: expected a JSON object.');
  }
  const envelope = value as Record<string, unknown>;
  if (envelope.ok !== true) throw new Error('RDX_CLI_FAILED: native rdx did not report ok:true.');
  if (typeof envelope.result_kind !== 'string' || !envelope.result_kind
    || !envelope.data || typeof envelope.data !== 'object' || Array.isArray(envelope.data)) {
    throw new Error('RDX_CLI_PROTOCOL: missing result_kind or data.');
  }
  const responseContext = (envelope.data as Record<string, unknown>).context_id;
  if (expectedContext && responseContext !== expectedContext) {
    throw new Error('RDX_CONTEXT_MISMATCH: CLI response does not belong to the owning daemon context.');
  }
  return envelope as unknown as RdxNativeEnvelope;
}

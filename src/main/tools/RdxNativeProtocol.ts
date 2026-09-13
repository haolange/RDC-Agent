import type { CLIResult } from '@shared/types/tool';

export interface RdxNativeEnvelope {
  ok: true;
  context_id?: string;
  result_kind: string;
  data: Record<string, unknown>;
  [key: string]: unknown;
}

/** Fail before any lease/experiment state is committed. Never surface binary stdout. */
export function parseRdxNativeResult(result: CLIResult, expectedContext?: string, expectedKind?: string): RdxNativeEnvelope {
  if (result.exitCode !== 0 && !result.stdout.trim()) {
    throw new Error(`RDX_CLI_FAILED: native rdx exited with code ${result.exitCode} without a result.`);
  }
  let value: unknown;
  try { value = JSON.parse(result.stdout); } catch {
    throw new Error('RDX_CLI_PROTOCOL: expected a canonical JSON result.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('RDX_CLI_PROTOCOL: expected a JSON object.');
  }
  const envelope = value as Record<string, unknown>;
  if (envelope.ok === false && envelope.error && typeof envelope.error === 'object' && !Array.isArray(envelope.error)) {
    const failure = envelope.error as Record<string, unknown>;
    if (typeof failure.code === 'string' && typeof failure.message === 'string') {
      throw new Error(`RDX_CLI_FAILED: ${failure.code}: ${failure.message}`);
    }
  }
  if (result.exitCode !== 0) throw new Error('RDX_CLI_FAILED: native rdx exited with code ' + result.exitCode);
  if (envelope.ok !== true) throw new Error('RDX_CLI_FAILED: native rdx did not report ok:true.');
  if (typeof envelope.result_kind !== 'string' || !envelope.result_kind
    || !envelope.data || typeof envelope.data !== 'object' || Array.isArray(envelope.data)) {
    throw new Error('RDX_CLI_PROTOCOL: missing result_kind or data.');
  }
  if (expectedKind && envelope.result_kind !== expectedKind) throw new Error('RDX_CLI_PROTOCOL: unexpected result_kind.');
  const responseContext = (envelope.data as Record<string, unknown>).context_id;
  if (expectedContext && responseContext !== expectedContext) {
    throw new Error('RDX_CONTEXT_MISMATCH: CLI response does not belong to the owning daemon context.');
  }
  return envelope as unknown as RdxNativeEnvelope;
}

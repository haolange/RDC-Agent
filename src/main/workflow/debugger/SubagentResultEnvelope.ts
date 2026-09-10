import type { TaskCompletionResult, TaskExecutionRecord } from '../../agent-runtime/tasks';
import type { TurnCompletionDeclaration } from './TurnCoordinator';
import { sessionArtifactResolver, type SessionArtifactResolver } from '../../sessions/SessionArtifactResolver';
import { formatSessionArtifactUri } from '@shared/types/sessionArtifact';

export interface PersistedSubagentResult { uri: string; hash: string }
export function persistSubagentResult(sessionId: string, executionId: string, value: unknown, resolver: Pick<SessionArtifactResolver, 'write' | 'read'> = sessionArtifactResolver): PersistedSubagentResult {
  const serialized = JSON.stringify(value);
  const chunks = Array.from({ length: Math.ceil(serialized.length / 4_000) }, (_, index) => serialized.slice(index * 4_000, (index + 1) * 4_000));
  const saved = resolver.write(sessionId, formatSessionArtifactUri('tool-outputs', `subagent-${executionId}.json`), JSON.stringify({ encoding: 'json-chunks', reconstruction: 'Join chunks without separators, then parse JSON.', chunks }, null, 2), { mimeType: 'application/json' });
  const verified = resolver.read(sessionId, saved.uri, { expectedHash: saved.hash, limit: 1 });
  if (verified.hash !== saved.hash) throw new Error('SUBAGENT_RESULT_VERIFY_FAILED: persisted result hash differs on readback.');
  return { uri: saved.uri, hash: saved.hash };
}
export function normalizeSubagentResult(text: string, status: 'complete' | 'failed' | 'cancelled', declaration: TurnCompletionDeclaration | null | undefined, artifact?: PersistedSubagentResult): TaskCompletionResult {
  const resultRef = artifact?.uri; const resultHash = artifact?.hash;
  if (status === 'cancelled') return { disposition: 'cancelled', summary: 'Subagent execution cancelled.', outputs: {}, resultRef, resultHash };
  if (status === 'failed') return { disposition: 'blocked', summary: 'Subagent execution failed; inspect the durable result artifact.', outputs: {}, error: 'SUBAGENT_EXECUTION_FAILED', resultRef, resultHash };
  if (declaration?.result) { const result = declaration.result; return { disposition: declaration.disposition === 'budget_paused' ? 'blocked' : declaration.disposition, summary: result.summary, outputs: { ...result.outputs }, resultRef, resultHash, evidenceRefs: [...declaration.evidenceRefs], counterevidence: [...result.counterevidence], unresolved: [...result.unresolved], scope: result.scope, sideEffects: [...result.sideEffects], recoveryState: [...result.recoveryState] }; }
  void text; // Unstructured transcript is preserved in the result artifact, never promoted into parent input.
  return { disposition: 'partial', summary: 'No structured result was returned; inspect the durable result artifact.', outputs: {}, error: 'SUBAGENT_STRUCTURED_RESULT_MISSING', resultRef, resultHash, unresolved: ['Structured result envelope missing'], missingRequirements: ['Structured result envelope'] };
}
/** Bounded parent data: omitted fields are explicit and remain recoverable in resultRef. */
export function projectSubagentResult(result: TaskCompletionResult) {
  const externalizedFields: string[] = [];
  function keep<T>(field: string, value: T, maxBytes: number, empty: T): T {
    if (Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8') <= maxBytes) return value;
    externalizedFields.push(field); return empty;
  }
  const projection = {
    disposition: result.disposition,
    summary: keep('summary', result.summary, 1_500, 'Structured summary externalized; read the result artifact.'),
    resultRef: result.resultRef,
    resultHash: result.resultHash,
    outputs: keep('outputs', result.outputs, 2_000, {}),
    evidenceRefs: keep('evidenceRefs', result.evidenceRefs ?? [], 2_000, []),
    counterevidence: keep('counterevidence', result.counterevidence ?? [], 1_000, []),
    unresolved: keep('unresolved', result.unresolved ?? [], 1_000, []),
    scope: keep('scope', result.scope ?? '', 1_000, 'Scope externalized; do not generalize without reading the result artifact.'),
    sideEffects: keep('sideEffects', result.sideEffects ?? [], 1_000, []),
    recoveryState: keep('recoveryState', result.recoveryState ?? [], 1_000, []),
    missingRequirements: keep('missingRequirements', result.missingRequirements ?? [], 1_000, []),
    error: result.error ? keep('error', result.error, 500, 'Error details externalized.') : undefined,
    externalizedFields,
  };
  if (externalizedFields.length && (!result.resultRef || !result.resultHash)) throw new Error('SUBAGENT_RESULT_REFERENCE_REQUIRED: cannot omit structured fields without a durable result reference.');
  return projection;
}
export function projectSubagentExecution(execution: TaskExecutionRecord | null | undefined) {
  if (!execution) return undefined;
  return { id: execution.id, taskId: execution.taskId, generation: execution.generation, status: execution.status, budget: execution.budget, frozenPlanRef: execution.frozenPlanRef, result: execution.result ? projectSubagentResult(execution.result) : undefined };
}
export function bounded(value: string, max: number): string { return value.length <= max ? value : `${value.slice(0, max - 20)}\n...[truncated]`; }

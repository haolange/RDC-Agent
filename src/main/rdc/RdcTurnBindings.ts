import { createHash } from 'node:crypto';
import { AppError } from '@shared/errors/appError';
import { deepFreeze, operationFingerprint, type RdcExecutionBudget } from './RdcOperationCatalog';
import type { RdcCliInvokerSettings } from '@shared/types/settings';

export interface RdcLeaseIdentity {
  contextId: string;
  version: number;
  ownerSessionId: string;
  runtimeContext?: { captureFileId?: string; replaySessionId?: string };
}
export interface RdcTurnBinding {
  identity: RdcLeaseIdentity | null;
  cli: RdcCliInvokerSettings;
  definitions: readonly Record<string, unknown>[];
  definitionsFingerprint: string;
}

/**
 * The frozen patience must lie inside every operation's published execution budget: RDC-Tool rejects a request outside
 * it before execution, so a binding that would send one fails here, naming the range. Catalog validation guarantees
 * every installed definition carries a budget.
 */
function assertNoProgressTimeout(cli: RdcCliInvokerSettings, definitions: readonly Record<string, unknown>[]): void {
  for (const definition of definitions) {
    const budget = definition.execution_budget as RdcExecutionBudget | undefined;
    if (!budget) continue;
    if (cli.noProgressTimeoutMs < budget.min_no_progress_ms || cli.noProgressTimeoutMs > budget.max_no_progress_ms) {
      throw new AppError(
        'RDC_NO_PROGRESS_TIMEOUT_UNSUPPORTED',
        `${String(definition.name)} accepts ${budget.min_no_progress_ms}-${budget.max_no_progress_ms} ms; ` +
          `the setting is ${cli.noProgressTimeoutMs} ms.`,
        {
          params: {
            seconds: Math.round(cli.noProgressTimeoutMs / 1000),
            minSeconds: Math.ceil(budget.min_no_progress_ms / 1000),
            maxSeconds: Math.floor(budget.max_no_progress_ms / 1000),
          },
        },
      );
    }
  }
}

/** Private turn leases: executable environment is never serialized into Prompt/IPC/Trace. */
const bindings = new WeakMap<object, RdcTurnBinding>();
export function freezeRdcTurnBinding(
  cli: RdcCliInvokerSettings,
  definitions: readonly Record<string, unknown>[] = [],
  identity: RdcLeaseIdentity | null = null,
): RdcTurnBinding {
  assertNoProgressTimeout(cli, definitions);
  const copy = structuredClone({
    cli,
    definitions,
    definitionsFingerprint: operationFingerprint(definitions),
    identity: identity
      ? {
          contextId: identity.contextId,
          version: identity.version,
          ownerSessionId: identity.ownerSessionId,
          runtimeContext: identity.runtimeContext
            ? {
                captureFileId: identity.runtimeContext.captureFileId,
                replaySessionId: identity.runtimeContext.replaySessionId,
              }
            : undefined,
        }
      : null,
  });
  return deepFreeze(copy);
}
export function rdcBindingFingerprint(binding: RdcTurnBinding): string {
  return createHash('sha256').update(JSON.stringify(binding)).digest('hex');
}
export function bindRdcTurn(plan: object, binding: RdcTurnBinding): void {
  bindings.set(plan, binding);
}
export function getRdcTurnBinding(plan: object): RdcTurnBinding | undefined {
  return bindings.get(plan);
}

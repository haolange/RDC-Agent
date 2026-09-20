import { createHash } from 'node:crypto';
import { deepFreeze, operationFingerprint } from './RdcOperationCatalog';
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

/** Private turn leases: executable environment is never serialized into Prompt/IPC/Trace. */
const bindings = new WeakMap<object, RdcTurnBinding>();
export function freezeRdcTurnBinding(
  cli: RdcCliInvokerSettings,
  definitions: readonly Record<string, unknown>[] = [],
  identity: RdcLeaseIdentity | null = null,
): RdcTurnBinding {
  const copy = structuredClone({
    cli,
    definitions,
    definitionsFingerprint: operationFingerprint(definitions),
    identity: identity ? { contextId: identity.contextId, version: identity.version, ownerSessionId: identity.ownerSessionId, runtimeContext: identity.runtimeContext ? { captureFileId: identity.runtimeContext.captureFileId, replaySessionId: identity.runtimeContext.replaySessionId } : undefined } : null,
  });
  return deepFreeze(copy);
}
export function rdcBindingFingerprint(binding: RdcTurnBinding): string {
  return createHash('sha256').update(JSON.stringify(binding)).digest('hex');
}
export function bindRdcTurn(plan: object, binding: RdcTurnBinding): void { bindings.set(plan, binding); }
export function getRdcTurnBinding(plan: object): RdcTurnBinding | undefined { return bindings.get(plan); }

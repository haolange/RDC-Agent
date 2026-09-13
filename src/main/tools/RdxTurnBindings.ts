import { createHash } from 'node:crypto';
import { deepFreeze, operationFingerprint } from './RdxOperationCatalog';
import type { RdxCliInvokerSettings } from '@shared/types/settings';

export interface RdxLeaseIdentity {
  contextId: string;
  version: number;
  ownerSessionId: string;
  runtimeContext?: { captureFileId?: string; replaySessionId?: string };
}
export interface RdxTurnBinding {
  identity: RdxLeaseIdentity | null;
  cli: RdxCliInvokerSettings;
  definitions: readonly Record<string, unknown>[];
  definitionsFingerprint: string;
}

/** Private turn leases: executable environment is never serialized into Prompt/IPC/Trace. */
const bindings = new WeakMap<object, RdxTurnBinding>();
export function freezeRdxTurnBinding(
  cli: RdxCliInvokerSettings,
  definitions: readonly Record<string, unknown>[] = [],
  identity: RdxLeaseIdentity | null = null,
): RdxTurnBinding {
  const copy = structuredClone({
    cli,
    definitions,
    definitionsFingerprint: operationFingerprint(definitions),
    identity: identity ? { contextId: identity.contextId, version: identity.version, ownerSessionId: identity.ownerSessionId, runtimeContext: identity.runtimeContext ? { captureFileId: identity.runtimeContext.captureFileId, replaySessionId: identity.runtimeContext.replaySessionId } : undefined } : null,
  });
  return deepFreeze(copy);
}
export function rdxBindingFingerprint(binding: RdxTurnBinding): string {
  return createHash('sha256').update(JSON.stringify(binding)).digest('hex');
}
export function bindRdxTurn(plan: object, binding: RdxTurnBinding): void { bindings.set(plan, binding); }
export function getRdxTurnBinding(plan: object): RdxTurnBinding | undefined { return bindings.get(plan); }

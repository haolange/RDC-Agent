import { createHash } from 'node:crypto';
import type { RequestPlan } from '@shared/types/providerCapability';
import type { ProviderStateRef } from '@shared/types/reasoning';
import type { Context } from '../core/types';

export type ProviderStateReuseReason =
  | 'reusable'
  | 'state-mode-disabled'
  | 'invalid-state'
  | 'carrier-mismatch'
  | 'provider-boundary-mismatch'
  | 'model-mismatch'
  | 'compatibility-group-mismatch';

export interface ProviderStateSelection {
  state: ProviderStateRef;
  assistantMessageIndex: number;
}

export function createProviderStateRef(
  requestPlan: RequestPlan,
  value: string | undefined,
): ProviderStateRef | undefined {
  const normalized = value?.trim();
  const carrier = requestPlan.statePlan.carrier;
  if (
    requestPlan.statePlan.mode !== 'provider-managed'
    || !normalized
    || carrier === 'none'
    || carrier === 'unknown'
  ) return undefined;
  const envelope = {
    schemaVersion: 1 as const,
    carrier,
    value: normalized,
    origin: {
      ...requestPlan.executionIdentity,
      bindingIds: [...requestPlan.executionIdentity.bindingIds],
    },
    originFingerprint: requestPlan.executionIdentity.fingerprint,
  };
  return {
    ...envelope,
    integrityHash: hashCanonical(envelope),
  };
}

export function verifyProviderStateRef(state: ProviderStateRef): boolean {
  return state.schemaVersion === 1
    && state.originFingerprint === state.origin.fingerprint
    && state.integrityHash === hashCanonical({
      schemaVersion: state.schemaVersion,
      carrier: state.carrier,
      value: state.value,
      origin: state.origin,
      originFingerprint: state.originFingerprint,
    });
}

export function providerStateReuseReason(
  state: ProviderStateRef | undefined,
  target: RequestPlan,
): ProviderStateReuseReason {
  if (target.statePlan.mode !== 'provider-managed') return 'state-mode-disabled';
  if (!state || !verifyProviderStateRef(state)) return 'invalid-state';
  if (state.carrier !== target.statePlan.carrier) return 'carrier-mismatch';
  if (!sameProviderBoundary(state, target)) return 'provider-boundary-mismatch';

  const crossModel = target.contracts.state.crossModel;
  if (crossModel === 'never') {
    return sameModelExecution(state, target) ? 'reusable' : 'model-mismatch';
  }
  if (crossModel === 'same-compatibility-group') {
    return state.origin.compatibilityGroup === target.executionIdentity.compatibilityGroup
      ? 'reusable'
      : 'compatibility-group-mismatch';
  }
  if (crossModel === 'provider-managed') return 'reusable';
  return 'provider-boundary-mismatch';
}

export function findLatestProviderState(
  context: Context,
  target: RequestPlan,
): ProviderStateSelection | undefined {
  for (let index = context.messages.length - 1; index >= 0; index -= 1) {
    const message = context.messages[index];
    if (message.role !== 'assistant' || !message.providerState) continue;
    if (providerStateReuseReason(message.providerState, target) === 'reusable') {
      return {
        state: message.providerState,
        assistantMessageIndex: index,
      };
    }
  }
  return undefined;
}

function sameProviderBoundary(state: ProviderStateRef, target: RequestPlan): boolean {
  const source = state.origin;
  const next = target.executionIdentity;
  return source.providerId === next.providerId
    && source.credentialScopeHash === next.credentialScopeHash
    && source.endpointHash === next.endpointHash
    && source.protocolFamily === next.protocolFamily
    && source.protocolDialect === next.protocolDialect
    && source.protocolVersion === next.protocolVersion;
}

function sameModelExecution(state: ProviderStateRef, target: RequestPlan): boolean {
  const source = state.origin;
  const next = target.executionIdentity;
  return source.effectiveModelId === next.effectiveModelId
    && source.canonicalModelId === next.canonicalModelId
    && source.modelSnapshotId === next.modelSnapshotId
    && source.variantKey === next.variantKey;
}

function hashCanonical(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return '{' + Object.keys(record).sort()
      .map((key) => JSON.stringify(key) + ':' + stableJson(record[key]))
      .join(',') + '}';
  }
  if (value === undefined) return 'null';
  return JSON.stringify(value);
}

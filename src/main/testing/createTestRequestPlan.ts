import type {
  ContextTransitionPlan,
  ExecutionIdentity,
  RequestPlan,
} from '@shared/types/providerCapability';
import { createFailClosedProviderContracts } from '@shared/provider-catalog/providerContracts';

type CompiledPlanFields =
  | 'contracts'
  | 'executionIdentity'
  | 'statePlan'
  | 'cachePlan'
  | 'toolLoopPlan'
  | 'streamingPlan'
  | 'contextTransitionPlan';

export type TestRequestPlanInput = Omit<RequestPlan, CompiledPlanFields | 'maxOutputTokens' | 'compactionThresholdTokens'> &
  Partial<Pick<RequestPlan, CompiledPlanFields | 'maxOutputTokens' | 'compactionThresholdTokens'>>;

export function createTestRequestPlan(input: TestRequestPlanInput): RequestPlan {
  const contracts = input.contracts
    ?? input.route.contracts
    ?? createFailClosedProviderContracts(input.route.protocol);
  const statePlan = input.statePlan ?? {
    mode: 'local-stateless' as const,
    carrier: 'none' as const,
    store: false,
    reuseProviderState: false,
  };
  const toolLoopPlan = input.toolLoopPlan ?? {
    phase: 'top-level' as const,
    pinned: true as const,
    artifactPolicy: contracts.toolLoop.artifactPolicy,
    artifactScope: contracts.toolLoop.artifactScope,
    ordering: contracts.toolLoop.ordering,
  };
  const contextTransitionPlan: ContextTransitionPlan = input.contextTransitionPlan ?? {
    strategy: 'semantic-replay',
    portable: true,
    reason: 'Test fixture local stateless replay.',
  };
  const identityBase: Omit<ExecutionIdentity, 'fingerprint'> = {
    schemaVersion: 1,
    providerId: input.providerId,
    credentialScopeHash: 'test-credential-scope',
    endpointHash: 'test-endpoint',
    protocolFamily: input.route.protocol,
    protocolDialect: contracts.protocolDialect,
    protocolVersion: contracts.protocolVersion,
    catalogRevision: input.catalogRevision,
    routeRevision: input.routeRevision,
    selectedModelId: input.selectedModelId,
    effectiveModelId: input.effectiveModelId,
    canonicalModelId: input.effectiveModelId,
    modelSnapshotId: 'test-model-snapshot',
    compatibilityGroup: contracts.compatibilityGroup,
    bindingIds: [...input.appliedBindingIds],
    variantKey: 'test-variant',
    reasoningMode: input.reasoningWire.selection,
    contextMode: input.contextMode,
    stateMode: statePlan.mode,
    artifactFormat: contracts.reasoning.artifactFormat,
    artifactVersion: contracts.reasoning.artifactVersion,
    contractHash: 'test-contract',
    toolLoopPhase: toolLoopPlan.phase,
  };
  return {
    ...input,
    maxOutputTokens: input.maxOutputTokens ?? 0,
    compactionThresholdTokens: input.compactionThresholdTokens
      ?? Math.floor((input.contextBudgetTokens * 80) / 100),
    route: { ...input.route, contracts },
    contracts,
    executionIdentity: input.executionIdentity ?? {
      ...identityBase,
      fingerprint: 'test-execution',
    },
    statePlan,
    cachePlan: input.cachePlan ?? {
      enabled: false,
      mode: contracts.cache.mode,
      keyCarrier: contracts.cache.keyCarrier,
      breakpointCarrier: contracts.cache.breakpointCarrier,
      telemetry: [...contracts.cache.telemetry],
      ttl: contracts.cache.ttl,
    },
    toolLoopPlan,
    streamingPlan: input.streamingPlan ?? { ...contracts.streaming },
    contextTransitionPlan,
  };
}

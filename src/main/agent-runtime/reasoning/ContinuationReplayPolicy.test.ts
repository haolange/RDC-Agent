import { describe, expect, it } from 'vitest';
import type { ProviderContractBundle } from '@shared/provider-catalog/modelManifestSchema';
import { createFailClosedProviderContracts } from '@shared/provider-catalog/providerContracts';
import type { RequestPlan } from '@shared/types/providerCapability';
import { createTestRequestPlan } from '../../testing/createTestRequestPlan';
import {
  createContinuationArtifact,
  toContinuationMetadata,
} from './ContinuationArtifacts';
import { decideContinuationReplay } from './ContinuationReplayPolicy';

type Policy = ProviderContractBundle['reasoning']['continuation'];
type ArtifactPolicy = ProviderContractBundle['toolLoop']['artifactPolicy'];
type ArtifactScope = ProviderContractBundle['toolLoop']['artifactScope'];

function plan(options: {
  providerId?: string;
  modelId?: string;
  policy?: Policy;
  artifactPolicy?: ArtifactPolicy;
  artifactScope?: ArtifactScope;
  compatibilityGroup?: string;
  carrier?: ProviderContractBundle['reasoning']['carrier'];
  stateMode?: 'local-stateless' | 'provider-managed';
} = {}): RequestPlan {
  const providerId = options.providerId ?? 'provider-a';
  const modelId = options.modelId ?? 'model-a';
  const protocol = 'OpenAIResponses' as const;
  const compatibilityGroup = options.compatibilityGroup ?? 'compat-v1';
  const carrier = options.carrier ?? 'reasoning-item';
  const fallback = createFailClosedProviderContracts(protocol);
  const contracts: ProviderContractBundle = {
    ...fallback,
    protocolDialect: 'responses-v1',
    protocolVersion: 'v1',
    compatibilityGroup,
    reasoning: {
      semantic: 'opaque',
      source: 'test',
      displayLabel: 'Provider reasoning',
      carrier,
      artifactFormat: carrier + '-format',
      artifactVersion: 'v1',
      compatibilityGroup,
      continuation: options.policy ?? 'exact-execution',
    },
    state: options.stateMode === 'provider-managed'
      ? {
          supportedModes: ['local-stateless', 'provider-managed'],
          defaultMode: 'provider-managed',
          carrier: 'previous-response-id',
          retention: 'provider',
          crossModel: 'provider-managed',
        }
      : fallback.state,
    toolLoop: {
      artifactPolicy: options.artifactPolicy ?? 'preserve-exact',
      artifactScope: options.artifactScope ?? 'all-assistant-turns',
      ordering: 'provider-native',
      modelSwitch: 'pin-until-terminal',
    },
  };
  return createTestRequestPlan({
    providerId,
    adapterId: 'openai-responses',
    catalogRevision: 'catalog-v1',
    routeRevision: 'route-v1',
    selectedModelId: modelId,
    effectiveModelId: modelId,
    appliedBindingIds: [],
    route: {
      protocol,
      baseUrl: 'https://example.test',
      source: 'catalog',
      contracts,
    },
    contracts,
    statePlan: options.stateMode === 'provider-managed'
      ? {
          mode: 'provider-managed',
          carrier: 'previous-response-id',
          store: true,
          reuseProviderState: true,
        }
      : undefined,
    headers: {},
    bodyPatch: {},
    contextBudgetTokens: 100_000,
    contextMode: 'normal',
    contextWindowTokens: 128_000,
    activeTierId: 'default',
    fastMode: false,
    reasoningWire: {
      selection: 'off',
      control: {
        kind: 'none',
        supportsOff: true,
        levels: [],
        defaultSelection: 'off',
        wireProfile: { kind: 'none' },
      },
    },
  });
}

describe('ContinuationReplayPolicy', () => {
  it('requires every exact execution field to match', () => {
    const source = plan();
    const artifact = createContinuationArtifact(source, {
      type: 'reasoning',
      encryptedContent: 'sealed',
    });
    expect(decideContinuationReplay(artifact, source, { sameToolLoop: false }))
      .toEqual({ action: 'replay', reason: 'exact-execution' });

    const changedEndpoint = {
      ...source,
      executionIdentity: {
        ...source.executionIdentity,
        endpointHash: 'different-endpoint',
      },
    };
    expect(decideContinuationReplay(artifact, changedEndpoint, { sameToolLoop: false }))
      .toEqual({ action: 'drop', reason: 'execution-mismatch' });
  });

  it('allows same-provider-model only when the provider boundary and model snapshot stay pinned', () => {
    const source = plan({ policy: 'same-provider-model' });
    const artifact = createContinuationArtifact(source, { type: 'reasoning', encryptedContent: 'sealed' });
    const nextRevision = {
      ...source,
      catalogRevision: 'catalog-v2',
      routeRevision: 'route-v2',
      executionIdentity: {
        ...source.executionIdentity,
        catalogRevision: 'catalog-v2',
        routeRevision: 'route-v2',
      },
    };
    expect(decideContinuationReplay(artifact, nextRevision, { sameToolLoop: false }).action).toBe('replay');

    const changedModel = plan({ policy: 'same-provider-model', modelId: 'model-b' });
    expect(decideContinuationReplay(artifact, changedModel, { sameToolLoop: false }).action).toBe('drop');
  });

  it('allows a model change only through an explicit same-compatibility-group contract', () => {
    const source = plan({ policy: 'same-compatibility-group', compatibilityGroup: 'family-v1' });
    const artifact = createContinuationArtifact(source, { type: 'reasoning', encryptedContent: 'sealed' });
    const sibling = plan({
      policy: 'same-compatibility-group',
      compatibilityGroup: 'family-v1',
      modelId: 'model-b',
    });
    expect(decideContinuationReplay(artifact, sibling, { sameToolLoop: false }))
      .toEqual({ action: 'replay', reason: 'same-compatibility-group' });

    const unrelated = plan({
      policy: 'same-compatibility-group',
      compatibilityGroup: 'family-v2',
      modelId: 'model-b',
    });
    expect(decideContinuationReplay(artifact, unrelated, { sameToolLoop: false }).action).toBe('drop');
  });

  it('enforces tool-loop scope and container binding', () => {
    const source = plan({
      carrier: 'thought-signature',
      artifactPolicy: 'preserve-thought-signature',
      artifactScope: 'tool-call-turn',
    });
    const artifact = createContinuationArtifact(source, {
      type: 'thought_signature',
      thoughtSignature: 'signature',
      containerBinding: {
        providerBlockKey: 'candidate:0:part:0',
        toolCallIds: ['tool-1'],
      },
    });
    expect(decideContinuationReplay(artifact, source, {
      sameToolLoop: false,
      providerBlockKey: 'candidate:0:part:0',
      toolCallIds: ['tool-1'],
    }).reason).toBe('scope-ended');
    expect(decideContinuationReplay(artifact, source, {
      sameToolLoop: true,
      providerBlockKey: 'candidate:0:part:1',
      toolCallIds: ['tool-1'],
    }).reason).toBe('container-mismatch');
    expect(decideContinuationReplay(artifact, source, {
      sameToolLoop: true,
      providerBlockKey: 'candidate:0:part:0',
      toolCallIds: ['tool-1'],
    }).action).toBe('replay');
  });

  it('drops provider-managed continuation when the effective model changes', () => {
    const source = plan({
      modelId: 'model-a',
      policy: 'provider-managed',
      artifactPolicy: 'provider-managed',
      artifactScope: 'provider-managed',
      stateMode: 'provider-managed',
    });
    const target = plan({
      modelId: 'model-b',
      policy: 'provider-managed',
      artifactPolicy: 'provider-managed',
      artifactScope: 'provider-managed',
      stateMode: 'provider-managed',
    });
    const artifact = createContinuationArtifact(source, { type: 'response_state', opaqueState: 'state-id' });
    expect(decideContinuationReplay(artifact, target, { sameToolLoop: false }))
      .toEqual({ action: 'drop', reason: 'execution-mismatch' });
  });

  it('separates provider-managed state from replayable artifacts', () => {
    const source = plan({
      policy: 'provider-managed',
      artifactPolicy: 'provider-managed',
      artifactScope: 'provider-managed',
      stateMode: 'provider-managed',
    });
    const artifact = createContinuationArtifact(source, { type: 'response_state', opaqueState: 'state-id' });
    expect(decideContinuationReplay(artifact, source, { sameToolLoop: false }))
      .toEqual({ action: 'provider-managed', reason: 'provider-managed' });
  });

  it('fails integrity checks and never exposes payload through shared metadata', () => {
    const source = plan();
    const artifact = createContinuationArtifact(source, {
      type: 'reasoning',
      encryptedContent: 'sealed',
      raw: { secret: 'opaque' },
    });
    if (!artifact) throw new Error('fixture failed');
    expect(toContinuationMetadata(artifact)).not.toHaveProperty('encryptedContent');
    expect(toContinuationMetadata(artifact)).not.toHaveProperty('raw');

    const metadataTampered = { ...artifact, compatibilityGroup: 'forged-group' };
    expect(decideContinuationReplay(metadataTampered, source, { sameToolLoop: false }))
      .toEqual({ action: 'drop', reason: 'invalid-integrity' });

    artifact.encryptedContent = 'tampered';
    expect(decideContinuationReplay(artifact, source, { sameToolLoop: false }))
      .toEqual({ action: 'drop', reason: 'invalid-integrity' });
  });
});

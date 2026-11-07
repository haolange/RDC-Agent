import { expect, it } from 'vitest';
import type { PromptPlan } from '@shared/types/rdcRuntime';
import { createNoneReasoningContract } from '@shared/provider-catalog/providerContracts';
import { buildEffectiveRuntimePlan } from '../EffectiveRuntimePlan';
import { compilePolicyFromRestrictive } from '../permissions/PolicyCompiler';
import { freezeRdcTurnBinding, getRdcTurnBinding, rdcBindingFingerprint } from '../../rdc/RdcTurnBindings';
import type { RdcContextLease } from '../../rdc/RdcRuntimeContextRegistry';
import { prepareRdcRuntimeEpoch } from './RdcRuntimeReprepare';

it('rebuilds the next request from frozen authority and refuses catalog or prior-plan drift', () => {
  const cli = { enabled: true, command: 'rdc', argsPrefix: [], workingDirectory: '', env: {}, timeoutMs: 1000 };
  const old = { ownerSessionId: 's', ownerProjectId: 'p', contextId: 'old', version: 1, captureHash: 'old',
    runtimeContext: { contextId: 'old', replaySessionId: 'old-replay', captureFileId: 'old-file' } } as RdcContextLease;
  const lease = { ...old, contextId: 'new', version: 2, captureHash: 'new',
    runtimeContext: { contextId: 'new', replaySessionId: 'new-replay', captureFileId: 'new-file' } } as RdcContextLease;
  const catalog = [{ name: 'rd.test', effects: [] }];
  const previousBinding = freezeRdcTurnBinding(cli, catalog, old);
  const previousPrompt = { id: 'prompt', systemPrompt: 'stable\n\nold', totalTokenEstimate: 2,
    segments: [{ id: 'core', kind: 'core-contract', scope: 'builtin', sourcePath: 'builtin', sourceHash: 'hash', precedence: 0,
      content: 'stable', tokenEstimate: 1, stability: 'stable' },
    { id: 'runtime:identity', kind: 'runtime-fact', scope: 'runtime', sourcePath: 'runtime://identity', sourceHash: 'hash', precedence: 1,
      content: 'old', tokenEstimate: 1, stability: 'volatile' }],
    stablePrefix: { fingerprint: 'stable', segmentIds: ['core'], sourceHashes: [], tokenEstimate: 1, volatileSegmentIds: ['runtime:identity'] },
    metrics: { systemPrompt: 11, scopedInstructions: 0, skills: 0 }, diagnostics: [] } as PromptPlan;
  const previousPlan = buildEffectiveRuntimePlan({ agentId: 'general', projectId: 'p', projectRootPath: null,
    toolAllowlist: ['rdc_probe'], permissionConstraints: { readableRoots: [], writableRoots: [], allowedCommandPrefixes: [], deniedCommandPrefixes: [] },
    routeCapability: { providerId: 'p', modelId: 'm', toolCallingMode: 'native-structured', reasoningVisibility: 'none', reasoningDelivery: 'none',
      reasoningContract: createNoneReasoningContract('test'), supportsStreaming: true, supportsToolResults: true, toolCallingEvidence: 'supported',
      toolCallingUnverified: false, visionInputMode: 'disabled', structuredOutputMode: 'native' },
    requestPlan: { executionIdentity: { fingerprint: 'request' } }, promptPlan: previousPrompt,
    policy: compilePolicyFromRestrictive({}), rdcBindingFingerprint: rdcBindingFingerprint(previousBinding) });
  const args = { sessionId: 's', projectId: 'p', permissionRevision: 2, previousPlan, previousPrompt, previousBinding, lease, catalog };
  const result = prepareRdcRuntimeEpoch(args);
  expect(result.plan.fingerprint).not.toBe(previousPlan.fingerprint);
  expect(result.plan.permissionConstraints).toEqual(previousPlan.permissionConstraints);
  expect(result.plan.requestPlanFingerprint).toBe(previousPlan.requestPlanFingerprint);
  expect(result.prompt.systemPrompt).toContain('new-replay');
  expect(getRdcTurnBinding(result.plan)).toEqual(result.binding);
  expect(() => prepareRdcRuntimeEpoch({ ...args, catalog: [{ name: 'changed' }] })).toThrow('RDC_REPREPARE_CATALOG_CHANGED');
  expect(() => prepareRdcRuntimeEpoch({ ...args, previousPrompt: { ...previousPrompt, systemPrompt: 'tampered' } }))
    .toThrow('RDC_REPREPARE_FROZEN_PLAN_CHANGED');
  expect(() => prepareRdcRuntimeEpoch({ ...args, lease: { ...lease, ownerProjectId: 'other' } }))
    .toThrow('RDC_REPREPARE_OWNER_INVALID');
});

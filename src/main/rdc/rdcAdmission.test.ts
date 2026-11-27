import { describe, expect, it } from 'vitest';
import { AppError } from '@shared/errors/appError';
import {
  decideAdmission,
  type AdmissionRequest,
  type AdmissionTurn,
} from '../agent-runtime/permissions/PermissionAdmission';
import { createRdcAdmissionAdapter, type RdcAdmissionHost } from './rdcAdmission';
import { freezeRdcTurnBinding } from './RdcTurnBindings';
import type { RdcExecutionReceipt } from './RdcExecutionReceipts';
import type { RdcOperationDefinition } from './RdcOperationCatalog';
import type { PlanAuthorization } from '@shared/types/planInvestigation';
import type { ToolExecutionContext } from '../agent-runtime/agent/AgentTool';

const replacement: RdcOperationDefinition = {
  name: 'rd.shader.edit_and_replace',
  namespace: 'rd.shader',
  description: 'Replace a shader in the replay.',
  input_schema: {
    type: 'object',
    properties: { event_id: { type: 'integer' }, stage: { type: 'string' }, expected_source_hash: { type: 'string' } },
  },
  scope: 'replay',
  effects: ['shader_replacement', 'replay_position', 'artifact_write'],
  evidence_kind: 'intervention',
  path_inputs: [],
  execution_budget: null,
  prerequisites: [],
} as unknown as RdcOperationDefinition;
const revert = {
  ...replacement,
  name: 'rd.shader.revert_replacement',
  effects: ['shader_replacement', 'replay_position'],
  evidence_kind: 'rollback',
} as RdcOperationDefinition;

const lease = {
  ownerSessionId: 'session',
  contextId: 'context',
  version: 3,
  runtimeContext: { replaySessionId: 'replay' },
};
function context(definitions: RdcOperationDefinition[] = [replacement, revert]): ToolExecutionContext {
  return {
    sessionId: 'session',
    projectId: 'project',
    turnId: 'turn',
    agentId: 'general',
    accessCeiling: 'full',
    rdcBinding: freezeRdcTurnBinding(
      { enabled: true, command: 'tool', argsPrefix: [], noProgressTimeoutMs: 60_000 } as never,
      definitions as never,
      lease,
    ),
  } as ToolExecutionContext;
}
const baselineReceipt = {
  experimentId: 'experiment',
  contextId: 'context',
  leaseVersion: 3,
  replaySessionId: 'replay',
  evidence: { kind: 'measurement' },
} as RdcExecutionReceipt;
function host(receipts: RdcExecutionReceipt[] = [baselineReceipt], exclusive = true): RdcAdmissionHost {
  return {
    receipts: { list: () => receipts },
    replayIsolation: () =>
      (exclusive ? { available: true } : { available: false, reason: 'not held' }) as ReturnType<
        RdcAdmissionHost['replayIsolation']
      >,
  };
}
const turn: AdmissionTurn = {
  sessionId: 'session',
  projectId: 'project',
  turnId: 'turn',
  agentId: 'general',
  accessCeiling: 'full',
  approved: {
    approvedAt: 1,
    contract: {
      mission: 'debugger',
      captureScope: {
        projectId: 'project',
        deviceId: 'device',
        comparisonGoal: 'Find the bad write.',
        inputs: [{ inputId: 'capture-a', fileName: 'a.rdc', contentSha256: 'f'.repeat(64) }],
      },
    },
  },
  captureBaseline: () => ({ available: true }),
};
const shell = { spec: { capture: { nativeOperation: (args: Record<string, unknown>) => args.rdc !== undefined } } };
const probe = {
  spec: {
    capture: {
      replayLifecycle: (args: Record<string, unknown>) =>
        ['capture_select', 'capture_restore', 'capture_recover'].includes(String(args.action)) ? args.action : null,
    },
  },
};
function shaderRequest(args: Record<string, unknown>, experimentId?: string, ctx = context()): AdmissionRequest {
  return {
    decision: { action: 'auto_review', risk: 'medium', reason: 'Shader change', temporaryPathRoots: [] },
    toolCall: {
      id: 'call',
      name: 'shell',
      arguments: { rdc: { operation: replacement.name, args, ...(experimentId ? { experimentId } : {}) } },
    },
    tool: shell,
    executionContext: ctx,
  } as unknown as AdmissionRequest;
}
function lifecycleRequest(args: Record<string, unknown>): AdmissionRequest {
  return {
    decision: { action: 'auto_review', risk: 'medium', reason: 'Replay change', temporaryPathRoots: [] },
    toolCall: { id: 'call', name: 'rdc_probe', arguments: args },
    tool: probe,
  } as unknown as AdmissionRequest;
}
const route = (assessment: ReturnType<ReturnType<typeof createRdcAdmissionAdapter>>) =>
  decideAdmission(assessment, 'medium', 'review');
const boundArgs = { stage: 'ps', event_id: 1248, expected_source_hash: 'a'.repeat(64) };

describe('shader replacement facts', () => {
  it('sends a replacement whose host facts all hold, but which no authorization covers, to the model with them', () => {
    const assessment = createRdcAdmissionAdapter(host())(shaderRequest(boundArgs, 'experiment'), turn);
    expect(assessment?.coverage).toBe('uncovered');
    expect(route(assessment)).toMatchObject({ route: 'model' });
    expect(
      assessment?.facts
        .filter((fact) => fact.state === 'holds')
        .map((fact) => fact.check)
        .sort(),
    ).toEqual(['baseline-recorded', 'identity-current', 'rollback-available', 'source-bound']);
  });

  it.each([
    ['an unbound source', { stage: 'ps' }, 'experiment', host(), context(), ['source-bound']],
    ['no experiment baseline', boundArgs, undefined, host(), context(), ['baseline-recorded']],
    [
      'a baseline from another replay',
      boundArgs,
      'experiment',
      host([{ ...baselineReceipt, leaseVersion: 2 }]),
      context(),
      ['baseline-recorded'],
    ],
    ['no rollback in the catalog', boundArgs, 'experiment', host(), context([replacement]), ['rollback-available']],
    [
      'a replay not exclusively held',
      boundArgs,
      'experiment',
      host([baselineReceipt], false),
      context(),
      ['identity-current'],
    ],
  ] as const)('refuses by rule, without the model, for %s', (_name, args, experimentId, admissionHost, ctx, checks) => {
    expect(route(createRdcAdmissionAdapter(admissionHost)(shaderRequest(args, experimentId, ctx), turn))).toMatchObject(
      { route: 'rule', verdict: { verdict: 'deny', failedChecks: checks } },
    );
  });

  it('leaves non-intervention native operations and non-native tools to the existing review', () => {
    const read = { ...replacement, name: 'rd.texture.get_data', effects: ['replay_position'], evidence_kind: null };
    const ctx = context([read as RdcOperationDefinition, revert]);
    const request = shaderRequest(boundArgs, 'experiment', ctx);
    (request.toolCall.arguments.rdc as Record<string, unknown>).operation = read.name;
    expect(createRdcAdmissionAdapter(host())(request, turn)).toBeNull();
    const edit = {
      ...request,
      toolCall: { id: 'edit', name: 'edit_file', arguments: { path: 'a.txt' } },
      tool: { spec: {} },
    } as unknown as AdmissionRequest;
    expect(createRdcAdmissionAdapter(host())(edit, turn)).toBeNull();
  });
});

describe('replay lifecycle facts', () => {
  const adapter = createRdcAdmissionAdapter(host());
  it("admits selecting a scoped input and restoring the signed entry by the plan's capture scope", () => {
    expect(route(adapter(lifecycleRequest({ action: 'capture_select', inputId: 'capture-a' }), turn))).toMatchObject({
      route: 'rule',
      verdict: { verdict: 'allow' },
    });
    expect(route(adapter(lifecycleRequest({ action: 'capture_restore' }), turn))).toMatchObject({
      route: 'rule',
      verdict: { verdict: 'allow' },
    });
  });

  it('refuses an input outside the scope and a mismatched entry record by rule', () => {
    expect(route(adapter(lifecycleRequest({ action: 'capture_select', inputId: 'capture-b' }), turn))).toMatchObject({
      route: 'rule',
      verdict: { verdict: 'deny', failedChecks: ['target-matches'] },
    });
    const mismatched: AdmissionTurn = {
      ...turn,
      captureBaseline: () => {
        throw new AppError('PERMISSION_REVIEW_EVIDENCE_INVALID', 'capture baseline does not match.');
      },
    };
    expect(route(adapter(lifecycleRequest({ action: 'capture_restore' }), mismatched))).toMatchObject({
      route: 'rule',
      verdict: { verdict: 'deny', failedChecks: ['baseline-recorded'] },
    });
  });

  it('sends lifecycle changes without an approved capture scope, or with an unverified entry, to the model', () => {
    const unscoped: AdmissionTurn = { ...turn, approved: null };
    expect(route(adapter(lifecycleRequest({ action: 'capture_recover' }), unscoped)).route).toBe('model');
    const unverified: AdmissionTurn = {
      ...turn,
      captureBaseline: () => ({ available: false, reason: 'RDC_INITIAL_STATE_UNVERIFIED' }),
    };
    expect(route(adapter(lifecycleRequest({ action: 'capture_restore' }), unverified)).route).toBe('model');
  });
});

describe('authorized interventions', () => {
  const authorization: PlanAuthorization = {
    operation: replacement.name,
    target: { eventId: 1248, stage: 'ps' },
    effect: 'shader_replacement',
    reversibility: 'rollback-available',
    maxInstances: 2,
  };
  const authorizedTurn = (overrides: Partial<PlanAuthorization> = {}): AdmissionTurn => ({
    ...turn,
    approved: {
      approvedAt: 1,
      contract: { ...turn.approved!.contract!, authorizations: [{ ...authorization, ...overrides }] },
    },
  });
  const applied = (replacementId: string) =>
    ({
      ...baselineReceipt,
      operation: replacement.name,
      args: { event_id: 1248, stage: 'ps' },
      completedAt: 5,
      evidence: { kind: 'intervention', replacementId },
    }) as RdcExecutionReceipt;
  const reverted = (replacementId: string) =>
    ({ ...applied(replacementId), evidence: { kind: 'rollback', replacementId } }) as RdcExecutionReceipt;

  it('admits a covered, reversible replacement whose facts all hold by rule, without the model', () => {
    const assessment = createRdcAdmissionAdapter(host())(shaderRequest(boundArgs, 'experiment'), authorizedTurn());
    expect(assessment?.coverage).toBe('covered');
    expect(route(assessment)).toMatchObject({ route: 'rule', verdict: { verdict: 'allow', failedChecks: [] } });
  });

  it.each([
    ['another target', { ...boundArgs, event_id: 999 }, [baselineReceipt], {}, ['target-matches']],
    [
      'no approved changes left',
      boundArgs,
      [baselineReceipt, applied('r1'), reverted('r1'), applied('r2')],
      {},
      ['instances-remaining'],
    ],
    [
      'an unreverted previous change',
      boundArgs,
      [baselineReceipt, applied('r1')],
      { reversibility: 'rollback-before-next' },
      ['prior-reverted'],
    ],
    ['an unbound source', { stage: 'ps', event_id: 1248 }, [baselineReceipt], {}, ['source-bound']],
  ] as const)('refuses a covered replacement by rule for %s', (_name, args, receipts, overrides, checks) => {
    expect(
      route(
        createRdcAdmissionAdapter(host([...receipts]))(shaderRequest(args, 'experiment'), authorizedTurn(overrides)),
      ),
    ).toMatchObject({ route: 'rule', verdict: { verdict: 'deny', failedChecks: checks } });
  });

  it('admits the next change once the previous one is reverted, and counts only changes since approval', () => {
    const receipts = [baselineReceipt, applied('r1'), reverted('r1'), { ...applied('old'), completedAt: 0 }];
    expect(
      route(
        createRdcAdmissionAdapter(host(receipts))(
          shaderRequest(boundArgs, 'experiment'),
          authorizedTurn({ reversibility: 'rollback-before-next' }),
        ),
      ),
    ).toMatchObject({ route: 'rule', verdict: { verdict: 'allow' } });
  });

  it('leaves an intervention no authorization item names to the model, with its host facts', () => {
    const other = authorizedTurn({ operation: 'rd.shader.other_change' });
    expect(route(createRdcAdmissionAdapter(host())(shaderRequest(boundArgs, 'experiment'), other)).route).toBe('model');
  });
});

import { describe, expect, it } from 'vitest';
import { preparePlanAuthorizations, targetMatches } from './rdcInterventionAuthorization';
import type { RdcOperationDefinition } from './RdcOperationCatalog';

const replacement = {
  name: 'rd.shader.edit_and_replace',
  scope: 'replay',
  effects: ['shader_replacement', 'replay_position', 'artifact_write'],
  evidence_kind: 'intervention',
  path_inputs: [],
  prerequisites: [],
  input_schema: {
    type: 'object',
    properties: {
      event_id: { type: 'integer', minimum: 0 },
      stage: { type: 'string', enum: ['vs', 'ps', 'cs'] },
      shader_id: { type: 'string' },
    },
  },
} as unknown as RdcOperationDefinition;
const revert = {
  ...replacement,
  name: 'rd.shader.revert_replacement',
  effects: ['shader_replacement', 'replay_position'],
  evidence_kind: 'rollback',
} as RdcOperationDefinition;
const item = {
  operation: replacement.name,
  target: { eventId: 1248, stage: 'ps' },
  effect: 'shader_replacement',
  reversibility: 'rollback-before-next',
  maxInstances: 3,
};
const prepare = (overrides: Partial<Parameters<typeof preparePlanAuthorizations>[0]> = {}) =>
  preparePlanAuthorizations({
    proposals: [item],
    definitions: [replacement, revert],
    targetsHaveFullCeiling: true,
    policyAllowsReview: true,
    hasCaptureScope: true,
    ...overrides,
  });

describe('plan authorizations', () => {
  it('freezes a reversible intervention the catalog, profile and policy all allow', () => {
    expect(prepare()).toEqual([item]);
    expect(targetMatches(item.target, { event_id: 1248, stage: 'ps', shader_id: 'any' })).toBe(true);
    expect(targetMatches(item.target, { event_id: 1248 })).toBe(false);
  });

  it.each([
    ['a non-full execution profile', { targetsHaveFullCeiling: false }],
    ['a policy that denies or always asks', { policyAllowsReview: false }],
    ['no capture scope', { hasCaptureScope: false }],
    ['an operation outside the catalog', { definitions: [revert] }],
    ['no catalog rollback', { definitions: [replacement] }],
    ['a broader effect than authorized', { proposals: [{ ...item, effect: 'artifact_write' }] }],
    ['a rollback operation instead of an intervention', { proposals: [{ ...item, operation: revert.name }] }],
    ['a target value outside the catalog contract', { proposals: [{ ...item, target: { stage: 'gs' } }] }],
    ['an empty target', { proposals: [{ ...item, target: {} }] }],
    ['the same target twice', { proposals: [item, item] }],
    ['too many approved changes', { proposals: [{ ...item, maxInstances: 17 }] }],
  ] as const)('refuses the plan for %s', (_name, overrides) => {
    expect(() => prepare(overrides as Partial<Parameters<typeof preparePlanAuthorizations>[0]>)).toThrow(
      /PLAN_AUTHORIZATION_INVALID/,
    );
  });
});

import { describe, expect, it } from 'vitest';
import { HANDOFF_ERROR } from '@shared/types/profileHandoff';
import { assertMissionExecutePlanGate, HandoffController } from './HandoffController';

describe('HandoffController frozen turn authority', () => {
  it('uses frozen project profile handoffs and enabled ids without rereading mutable settings', () => {
    const controller = new HandoffController();
    const allowed = controller.resolve('plan', 'edit', 'Explicit summary', undefined, {
      sourceHandoffs: [{ agent: 'edit', label: 'Implement', prompt: 'Apply the plan.', send: true }],
      enabledProfileIds: ['plan', 'edit'],
    });
    expect(allowed).toMatchObject({
      valid: true,
      request: { toProfile: 'edit', label: 'Implement', send: true, declaredModel: null },
    });
    expect(controller.resolve('plan', 'debugger', undefined, undefined, {
      sourceHandoffs: [{ agent: 'edit', label: 'Implement', prompt: 'Apply the plan.' }],
      enabledProfileIds: ['plan', 'edit', 'debugger'],
    })).toMatchObject({ valid: false, code: HANDOFF_ERROR.NOT_DECLARED });
    expect(controller.resolve('plan', 'edit', 'Explicit summary', undefined, {
      sourceHandoffs: [{ agent: 'edit', label: 'Implement', prompt: 'Apply the plan.' }],
      enabledProfileIds: ['plan'],
    })).toMatchObject({ valid: false, code: HANDOFF_ERROR.TARGET_DISABLED });
  });

  it('rejects every handoff when the frozen list is empty or omitted', () => {
    const controller = new HandoffController();
    expect(controller.resolve('general', 'debugger', undefined, undefined, {
      sourceHandoffs: [],
      enabledProfileIds: ['general', 'debugger'],
    })).toMatchObject({
      valid: false,
      code: HANDOFF_ERROR.NOT_DECLARED,
      reason: 'Profile "general" declares no handoffs.',
    });
    expect(controller.resolve('general', 'debugger', undefined, undefined, {
      sourceHandoffs: undefined as unknown as [],
      enabledProfileIds: ['general', 'debugger'],
    })).toMatchObject({ valid: false, code: HANDOFF_ERROR.NOT_DECLARED });
  });

  it('fails closed without a frozen plan', () => {
    const controller = new HandoffController();
    expect(controller.resolve('plan', 'edit')).toMatchObject({
      valid: false,
      code: HANDOFF_ERROR.REQUIRES_FROZEN_PLAN,
    });
  });

  it('copies send from the frozen declaration and ignores a prompt-only override', () => {
    const controller = new HandoffController();
    const resolved = controller.resolve('plan', 'edit', 'Custom prompt', undefined, {
      sourceHandoffs: [{ agent: 'edit', label: 'Implement', prompt: 'Apply the plan.', send: true }],
      enabledProfileIds: ['plan', 'edit'],
    });
    expect(resolved.request).toMatchObject({ send: true, prompt: 'Custom prompt' });
  });

  it('rejects a second handoff while one is already active', () => {
    const controller = new HandoffController();
    expect(controller.resolve('plan', 'edit', 'Explicit summary', undefined, {
      sourceHandoffs: [{ agent: 'edit', label: 'Implement', prompt: 'Apply the plan.' }],
      enabledProfileIds: ['plan', 'edit'],
      hasActiveHandoff: true,
    })).toMatchObject({ valid: false, code: HANDOFF_ERROR.ALREADY_ACTIVE });
  });

  it('rejects a sixth hop on the same user root chain', () => {
    const controller = new HandoffController();
    expect(controller.resolve('plan', 'edit', 'Explicit summary', undefined, {
      sourceHandoffs: [{ agent: 'edit', label: 'Implement', prompt: 'Apply the plan.' }],
      enabledProfileIds: ['plan', 'edit'],
      nextDepth: 6,
      chainRoot: 'root-1',
    })).toMatchObject({ valid: false, code: HANDOFF_ERROR.CHAIN_LIMIT });
  });

  it('rejects an illegal declaredModel without writing', () => {
    const controller = new HandoffController();
    expect(controller.resolve('plan', 'edit', 'Explicit summary', undefined, {
      sourceHandoffs: [{
        agent: 'edit',
        label: 'Implement',
        prompt: 'Apply the plan.',
        model: 'internal-provider:hidden',
      }],
      enabledProfileIds: ['plan', 'edit'],
      isDeclaredModelValid: () => false,
    })).toMatchObject({ valid: false, code: HANDOFF_ERROR.MODEL_INVALID });
  });

  it('requires an approved hash and target for Mission execute', () => {
    const hash = 'a'.repeat(64);
    expect(assertMissionExecutePlanGate({
      sourceAgentId: 'debugger',
      target: 'general',
      intent: 'execute',
      planHash: hash,
      approved: null,
    })).toMatchObject({ valid: false, code: HANDOFF_ERROR.PLAN_NOT_APPROVED });
    expect(assertMissionExecutePlanGate({
      sourceAgentId: 'debugger',
      target: 'general',
      intent: 'execute',
      planHash: hash,
      approved: { hash, target: 'analyzer', frozenUri: 'session://plans/plan-frozen.md' },
    })).toMatchObject({ valid: false, code: HANDOFF_ERROR.PLAN_NOT_APPROVED });
    expect(assertMissionExecutePlanGate({
      sourceAgentId: 'debugger',
      target: 'general',
      intent: 'execute',
      planHash: `sha256:${hash}`,
      planUri: 'session://plans/plan-frozen.md',
      approved: { hash, target: 'general', frozenUri: 'session://plans/plan-frozen.md' },
    })).toMatchObject({ valid: true });
    expect(assertMissionExecutePlanGate({
      sourceAgentId: 'general',
      target: 'debugger',
      intent: 'return',
    })).toMatchObject({ valid: true });
  });
});

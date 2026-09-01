import { describe, expect, it } from 'vitest';
import { HANDOFF_ERROR } from '@shared/types/profileHandoff';
import { HandoffController } from './HandoffController';

describe('HandoffController frozen turn authority', () => {
  it('uses frozen project profile handoffs and enabled ids without rereading mutable settings', () => {
    const controller = new HandoffController();
    const allowed = controller.resolve('plan', 'edit', undefined, undefined, {
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
    expect(controller.resolve('plan', 'edit', undefined, undefined, {
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
    expect(controller.resolve('plan', 'edit', undefined, undefined, {
      sourceHandoffs: [{ agent: 'edit', label: 'Implement', prompt: 'Apply the plan.' }],
      enabledProfileIds: ['plan', 'edit'],
      hasActiveHandoff: true,
    })).toMatchObject({ valid: false, code: HANDOFF_ERROR.ALREADY_ACTIVE });
  });

  it('rejects a fourth hop on the same user root chain', () => {
    const controller = new HandoffController();
    expect(controller.resolve('plan', 'edit', undefined, undefined, {
      sourceHandoffs: [{ agent: 'edit', label: 'Implement', prompt: 'Apply the plan.' }],
      enabledProfileIds: ['plan', 'edit'],
      nextDepth: 4,
      chainRoot: 'root-1',
    })).toMatchObject({ valid: false, code: HANDOFF_ERROR.CHAIN_LIMIT });
  });

  it('rejects an illegal declaredModel without writing', () => {
    const controller = new HandoffController();
    expect(controller.resolve('plan', 'edit', undefined, undefined, {
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
});

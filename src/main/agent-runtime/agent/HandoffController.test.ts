import { describe, expect, it } from 'vitest';
import { HandoffController } from './HandoffController';

describe('HandoffController frozen turn authority', () => {
  it('uses frozen project profile handoffs and enabled ids without rereading mutable settings', () => {
    const controller = new HandoffController();
    const allowed = controller.resolve('plan', 'edit', undefined, undefined, {
      sourceHandoffs: [{ agent: 'edit', label: 'Implement', prompt: 'Apply the plan.' }],
      enabledProfileIds: ['plan', 'edit'],
    });
    expect(allowed).toMatchObject({ valid: true, request: { toProfile: 'edit', label: 'Implement' } });
    expect(controller.resolve('plan', 'debugger', undefined, undefined, {
      sourceHandoffs: [{ agent: 'edit', label: 'Implement', prompt: 'Apply the plan.' }],
      enabledProfileIds: ['plan', 'edit', 'debugger'],
    })).toMatchObject({ valid: false });
    expect(controller.resolve('plan', 'edit', undefined, undefined, {
      sourceHandoffs: [{ agent: 'edit', label: 'Implement', prompt: 'Apply the plan.' }],
      enabledProfileIds: ['plan'],
    })).toMatchObject({ valid: false });
  });
});

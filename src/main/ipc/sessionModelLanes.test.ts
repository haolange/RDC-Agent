import { describe, expect, it } from 'vitest';
import { SessionModelLanes } from './sessionModelLanes';
import { SessionSetModelOverrideArgsSchema } from './validation/projectSessionSchemas';

const controls = { reasoningLevel: 'high' as const, fastModel: false, maxContextMode: false };

describe('session model lanes', () => {
  it('leaves a field alone when an older intent finishes after a newer one was written', () => {
    const lanes = new SessionModelLanes();
    const newer = { modelOverride: { providerId: 'p', modelId: 'y' }, clientRevision: 20 };
    const fields = lanes.newer('s', newer);
    expect(fields).toEqual({ modelOverride: newer.modelOverride });
    lanes.wrote('s', newer.clientRevision, fields);
    // The earlier choice checked its model more slowly and arrives at the write afterwards.
    expect(lanes.newer('s', { modelOverride: { providerId: 'p', modelId: 'x' }, clientRevision: 10 })).toEqual({});
  });

  it('orders the model and the controls as separate lanes, so neither intent loses the other', () => {
    const lanes = new SessionModelLanes();
    lanes.wrote('s', 20, lanes.newer('s', { modelOverride: null, clientRevision: 20 }));
    // Controls chosen before the model change still land: their lane has written nothing newer.
    expect(lanes.newer('s', { turnControls: controls, clientRevision: 10 })).toEqual({ turnControls: controls });
    expect(lanes.newer('other', { modelOverride: null, clientRevision: 5 })).toEqual({ modelOverride: null });
  });

  it('accepts only requests that set a field, with a positive safe-integer revision', () => {
    expect(SessionSetModelOverrideArgsSchema.safeParse(['s', { turnControls: controls, clientRevision: 1 }]).success).toBe(true);
    expect(SessionSetModelOverrideArgsSchema.safeParse(['s', { clientRevision: 1 }]).success).toBe(false);
    expect(SessionSetModelOverrideArgsSchema.safeParse(['s', { modelOverride: null, clientRevision: 0 }]).success).toBe(false);
  });
});

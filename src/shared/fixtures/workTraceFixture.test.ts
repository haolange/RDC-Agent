import { describe, expect, it } from 'vitest';
import { createWorkTraceFixture } from './workTraceFixture';

describe('work trace fixture', () => {
  it('grows linearly with its steps and leaves only the last step running', () => {
    const small = createWorkTraceFixture({ steps: 10 });
    const large = createWorkTraceFixture({ steps: 100 });
    expect(large.blocks).toHaveLength(100);
    expect(large.blocks.filter((block) => block.status === 'running').map((block) => block.id)).toEqual(['loop-99']);
    const ratio = JSON.stringify(large).length / JSON.stringify(small).length;
    expect(ratio).toBeGreaterThan(9);
    expect(ratio).toBeLessThan(11);
  });
});

import { describe, expect, it } from 'vitest';
import { buildCompactionPromptPlan } from './CompactionHandoffRuntime';
import { COMPACTION_HANDOFF_SYSTEM_PROMPT } from './StructuredHandoffBuilder';

describe('CompactionHandoffRuntime', () => {
  it('builds a tool-free PromptPlan from the shared compaction prompt', () => {
    const plan = buildCompactionPromptPlan('Goal: inspect the capture.');
    expect(plan.systemPrompt).toBe(COMPACTION_HANDOFF_SYSTEM_PROMPT);
    expect(plan.segments).toEqual([
      expect.objectContaining({
        id: 'runtime:compaction-handoff',
        kind: 'runtime-fact',
        scope: 'runtime',
        content: COMPACTION_HANDOFF_SYSTEM_PROMPT,
      }),
    ]);
    expect(plan.totalTokenEstimate).toBeGreaterThan(0);
  });
});

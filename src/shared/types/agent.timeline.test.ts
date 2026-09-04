import { describe, expect, it } from 'vitest';
import type { AgentTimelineEntry } from './agent';

const EMITTED_TIMELINE_TYPES = ['user', 'agent', 'system', 'tool_call'] as const satisfies ReadonlyArray<
  AgentTimelineEntry['type']
>;

describe('AgentTimelineEntry.type', () => {
  it('only accepts values that emitters actually assign', () => {
    const entries: AgentTimelineEntry[] = EMITTED_TIMELINE_TYPES.map((type) => ({
      id: type,
      type,
      content: type,
      timestamp: 0,
    }));
    expect(entries.map((entry) => entry.type)).toEqual([...EMITTED_TIMELINE_TYPES]);
  });
});

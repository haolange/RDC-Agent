import { describe, expect, it } from 'vitest';
import { ToolPool } from './ToolPool';
import type { AgentTool } from '../agent/AgentTool';

const tool = (name: string): AgentTool => ({
  name,
  description: `${name} desc`,
  parameters: { type: 'object', properties: {} },
  execute: async () => ({ content: [] }),
});

describe('ToolPool', () => {
  it('registers, queries, and clears tools', () => {
    const pool = new ToolPool();
    pool.register(tool('a'));
    pool.register(tool('b'));
    expect(pool.has('a')).toBe(true);
    expect(pool.get('a')?.name).toBe('a');
    expect(pool.allNames().sort()).toEqual(['a', 'b']);
    expect(pool.all()).toHaveLength(2);
    expect(pool.allMeta()).toEqual([
      { name: 'a', description: 'a desc', spec: undefined },
      { name: 'b', description: 'b desc', spec: undefined },
    ]);
    pool.clear();
    expect(pool.all()).toEqual([]);
  });
});

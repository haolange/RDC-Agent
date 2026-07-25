import { describe, expect, it } from 'vitest';
import { AGENT_WORKBENCH_TOOL_CATALOG } from './agentWorkbenchCatalog';

describe('agentWorkbenchCatalog', () => {
  it('loads catalog entries', () => {
    expect(AGENT_WORKBENCH_TOOL_CATALOG.length).toBeGreaterThan(0);
    expect(AGENT_WORKBENCH_TOOL_CATALOG.some((entry) => entry.id === 'read_file')).toBe(true);
  });
});

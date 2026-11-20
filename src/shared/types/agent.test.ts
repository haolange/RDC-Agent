import { describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_ID, GENERAL_AGENT_ID, TOP_LEVEL_AGENT_IDS, isTopLevelAgentId } from './agent';

describe('top-level agent identities', () => {
  it('lists the four builtin profiles and starts conversations with General', () => {
    expect(TOP_LEVEL_AGENT_IDS).toEqual(['general', 'debugger', 'analyzer', 'optimizer']);
    expect(GENERAL_AGENT_ID).toBe('general');
    expect(DEFAULT_AGENT_ID).toBe(GENERAL_AGENT_ID);
    expect(isTopLevelAgentId('verifier')).toBe(false);
  });
});

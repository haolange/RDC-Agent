import { describe, expect, it } from 'vitest';
import { isReservedAgentId } from './reservedAgentIds';

describe('Agent identity boundary', () => {
  it('keeps retired official ids out of the current profile namespace', () => {
    for (const id of ['ask', 'plan', 'edit', 'ask_agent', 'ask-agent', 'rdc-debugger', 'rdc_debugger', 'triage_agent', 'triage-agent']) {
      expect(isReservedAgentId(id)).toBe(true);
    }
    for (const id of ['general', 'debugger', 'analyzer', 'optimizer', 'my-custom-agent']) {
      expect(isReservedAgentId(id)).toBe(false);
    }
  });
});

import { describe, expect, it } from 'vitest';
import {
  isConcurrentModelSwitchCommand,
  shouldClearSubmittedPrompt,
} from './composerCommandConcurrency';

describe('composer command concurrency', () => {
  it('allows only the scoped /model command to bypass an in-flight turn', () => {
    expect(isConcurrentModelSwitchCommand('/model deepseek:deepseek-v4-pro')).toBe(true);
    expect(isConcurrentModelSwitchCommand(' /MODEL github-copilot:gemini-3.1-pro-preview ')).toBe(true);
    expect(isConcurrentModelSwitchCommand('/models')).toBe(false);
    expect(isConcurrentModelSwitchCommand('/settings')).toBe(false);
  });

  it('does not let an older completion erase a newer composer draft', () => {
    expect(shouldClearSubmittedPrompt('/model b', '/model a')).toBe(false);
    expect(shouldClearSubmittedPrompt(' /model a ', '/model a')).toBe(true);
  });
});

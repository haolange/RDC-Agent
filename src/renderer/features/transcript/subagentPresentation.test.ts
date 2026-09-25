import { describe, expect, it } from 'vitest';
import { formatInvocation } from './subagentPresentation';

describe('subagent presentation', () => {
  it('formats JSON only for the opened raw record and keeps plain text intact', () => {
    expect(formatInvocation('{"task":"read","mode":"wait"}')).toBe('{\n  "task": "read",\n  "mode": "wait"\n}');
    expect(formatInvocation('read only')).toBe('read only');
  });
});

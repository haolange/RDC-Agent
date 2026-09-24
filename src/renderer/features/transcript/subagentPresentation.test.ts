import { describe, expect, it } from 'vitest';
import { formatInvocation, summarizeDelegationTask } from './subagentPresentation';

describe('subagent presentation', () => {
  it('uses a concise header while preserving the full delegated task separately', () => {
    expect(summarizeDelegationTask('Compute 17+25 and report only the sum in one sentence. Do not use tools.'))
      .toBe('Compute 17+25');
    expect(summarizeDelegationTask('State the weekday that immediately follows Wednesday. One sentence.'))
      .toBe('State the weekday that immediately follows Wednesday.');
    expect(summarizeDelegationTask('读取项目配置，核对 schema_version 与 name。'))
      .toBe('读取项目配置，核对 schema_version 与 name');
  });

  it('formats JSON only for the opened raw record and keeps plain text intact', () => {
    expect(formatInvocation('{"task":"read","mode":"wait"}')).toBe('{\n  "task": "read",\n  "mode": "wait"\n}');
    expect(formatInvocation('read only')).toBe('read only');
  });
});

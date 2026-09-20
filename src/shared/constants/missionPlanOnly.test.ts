import { describe, expect, it } from 'vitest';
import {
  expandMissionPlanOnlyTokens,
  filterMissionPlanOnlyAllowlist,
  isMissionForbiddenToolId,
} from './missionPlanOnly';

describe('mission plan-only allowlist', () => {
  it('drops shell, interpreter, and output_register from token expansion', () => {
    const expanded = expandMissionPlanOnlyTokens([
      'read',
      'search',
      'task',
      'shell',
      'interpreter',
      'output',
      'rdc_probe',
    ]);
    expect(expanded).toEqual(expect.arrayContaining(['read_file', 'task_create', 'task_stop', 'turn_complete', 'background_join', 'background_cancel', 'rdc_probe']));
    expect(expanded).not.toContain('shell');
    expect(expanded).not.toContain('code_interpreter');
    expect(expanded).not.toContain('output_register');
  });

  it('filters a frozen allowlist down to plan-only ids', () => {
    expect(filterMissionPlanOnlyAllowlist(['read_file', 'shell', 'output_register', 'rdc_probe'])).toEqual([
      'read_file',
      'rdc_probe',
    ]);
    expect(isMissionForbiddenToolId('mcp__fs__write')).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { resolveHookTrustProjectRoot } from './hookTrustProjectRoot';

describe('resolveHookTrustProjectRoot', () => {
  it('omits projectRoot for user-scope trust and revoke', () => {
    expect(resolveHookTrustProjectRoot({
      scope: 'user',
      projectRoot: 'D:/open-project',
    })).toBeNull();
  });

  it('passes projectRoot for project-scope trust and revoke', () => {
    expect(resolveHookTrustProjectRoot({
      scope: 'project',
      projectRoot: 'D:/open-project',
    })).toBe('D:/open-project');
  });

  it('returns null when a project-scope hook has no project root', () => {
    expect(resolveHookTrustProjectRoot({ scope: 'project' })).toBeNull();
    expect(resolveHookTrustProjectRoot({ scope: 'project', projectRoot: null })).toBeNull();
  });

  it('never sends projectRoot for builtin hooks', () => {
    expect(resolveHookTrustProjectRoot({
      scope: 'builtin',
      projectRoot: 'D:/open-project',
    })).toBeNull();
  });
});

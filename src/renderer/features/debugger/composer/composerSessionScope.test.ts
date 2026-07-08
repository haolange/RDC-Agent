import { describe, expect, it } from 'vitest';
import { buildComposerSessionScopeKey } from './composerSessionScope';

describe('buildComposerSessionScopeKey', () => {
  it('separates drafts by project and session', () => {
    expect(buildComposerSessionScopeKey('project-a', 'session-1')).toBe('project-a:session-1');
    expect(buildComposerSessionScopeKey('project-a', 'session-2')).toBe('project-a:session-2');
    expect(buildComposerSessionScopeKey('project-b', 'session-1')).toBe('project-b:session-1');
  });

  it('uses a project-scoped pre-session draft key before a session exists', () => {
    expect(buildComposerSessionScopeKey('project-a', null)).toBe('project-a:no-session');
    expect(buildComposerSessionScopeKey(null, 'session-1')).toBe('no-project');
  });
});
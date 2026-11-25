import { beforeEach, describe, expect, it } from 'vitest';
import { useProjectStore } from './projectStore';
import { getActiveSessionId, isActiveSessionEvent, isActiveSessionScope } from './sessionEventGate';

describe('sessionEventGate', () => {
  beforeEach(() => {
    useProjectStore.setState({
      currentProject: null,
      currentSessionId: null,
    });
  });

  it('rejects events when no active session', () => {
    expect(isActiveSessionEvent('session-a')).toBe(false);
    expect(isActiveSessionEvent(null)).toBe(false);
    expect(getActiveSessionId()).toBeNull();
  });

  it('accepts only the active session id', () => {
    useProjectStore.setState({ currentSessionId: 'session-a' });
    expect(isActiveSessionEvent('session-a')).toBe(true);
    expect(isActiveSessionEvent('session-b')).toBe(false);
    expect(getActiveSessionId()).toBe('session-a');
    useProjectStore.setState({ currentProject: { projectId: 'project-1' } as never });
    expect(isActiveSessionScope({ projectId: 'project-1', sessionId: 'session-a' })).toBe(true);
    expect(isActiveSessionScope({ projectId: 'project-2', sessionId: 'session-a' })).toBe(false);
    expect(isActiveSessionScope({ projectId: 'project-1', sessionId: 'session-b' })).toBe(false);
  });
});

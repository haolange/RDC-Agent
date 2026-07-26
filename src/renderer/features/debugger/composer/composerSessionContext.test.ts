import { beforeEach, describe, expect, it } from 'vitest';
import {
  restoreLastSentIfCurrentSession,
  useComposerSessionContextStore,
} from './composerSessionContext';

describe('composerSessionContext', () => {
  beforeEach(() => {
    useComposerSessionContextStore.setState({
      activeTurn: null,
      lastSent: null,
      isPromptSending: false,
    });
  });

  it('restores lastSent only for the owning session', () => {
    useComposerSessionContextStore.getState().setLastSent({
      sessionId: 'session-a',
      projectId: 'project-1',
      prompt: 'hello from a',
      attachments: [],
      skillIds: [],
    });

    let restored = '';
    expect(restoreLastSentIfCurrentSession('session-b', (last) => {
      restored = last.prompt;
    })).toBe(false);
    expect(restored).toBe('');

    expect(restoreLastSentIfCurrentSession('session-a', (last) => {
      restored = last.prompt;
    })).toBe(true);
    expect(restored).toBe('hello from a');
  });

  it('resetForSessionSwitch clears active turn but keeps lastSent for owning restore', () => {
    useComposerSessionContextStore.getState().beginTurn({
      sessionId: 'session-a',
      projectId: 'project-1',
      requestId: 'req-1',
      optimisticTurnId: 'optimistic-turn-req-1',
      realTurnId: null,
    });
    useComposerSessionContextStore.getState().setLastSent({
      sessionId: 'session-a',
      projectId: 'project-1',
      prompt: 'draft',
      attachments: [],
      skillIds: [],
    });
    useComposerSessionContextStore.getState().setIsPromptSending(true);
    useComposerSessionContextStore.getState().resetForSessionSwitch();

    expect(useComposerSessionContextStore.getState().activeTurn).toBeNull();
    expect(useComposerSessionContextStore.getState().isPromptSending).toBe(false);
    expect(useComposerSessionContextStore.getState().lastSent?.prompt).toBe('draft');
  });
});

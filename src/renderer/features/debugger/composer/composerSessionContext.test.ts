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
      agentId: 'edit',
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

  it('commits and clears a turn only for the exact session, request, and agent owner', () => {
    const ownership = {
      sessionId: 'session-a',
      requestId: 'req-1',
      agentId: 'edit',
    };
    useComposerSessionContextStore.getState().beginTurn({
      ...ownership,
      projectId: 'project-1',
      optimisticTurnId: 'optimistic-turn-req-1',
      realTurnId: null,
    });

    useComposerSessionContextStore.getState().setRealTurnId(
      { ...ownership, agentId: 'plan' },
      'wrong-agent-turn',
    );
    useComposerSessionContextStore.getState().clearActiveTurnIfOwned({
      ...ownership,
      requestId: 'stale-request',
    });
    expect(useComposerSessionContextStore.getState().activeTurn?.realTurnId).toBeNull();

    useComposerSessionContextStore.getState().setRealTurnId(ownership, 'turn-1');
    expect(useComposerSessionContextStore.getState().activeTurn?.realTurnId).toBe('turn-1');

    useComposerSessionContextStore.getState().clearActiveTurnIfOwned(ownership);
    expect(useComposerSessionContextStore.getState().activeTurn).toBeNull();
  });

  it('rebinds a new-session turn to the committed session without weakening ownership', () => {
    const ownership = {
      sessionId: 'no-session',
      requestId: 'req-new',
      agentId: 'plan',
    };
    useComposerSessionContextStore.getState().beginTurn({
      ...ownership,
      projectId: 'project-1',
      optimisticTurnId: 'optimistic-turn-req-new',
      realTurnId: null,
    });

    useComposerSessionContextStore.getState().setRealTurnId(ownership, 'turn-new', 'session-new');

    expect(useComposerSessionContextStore.getState().activeTurn).toMatchObject({
      sessionId: 'session-new',
      requestId: 'req-new',
      agentId: 'plan',
      realTurnId: 'turn-new',
    });

    useComposerSessionContextStore.getState().clearActiveTurnIfOwned(ownership);
    expect(useComposerSessionContextStore.getState().activeTurn).not.toBeNull();

    useComposerSessionContextStore.getState().clearActiveTurnIfOwned({
      ...ownership,
      sessionId: 'session-new',
    });
    expect(useComposerSessionContextStore.getState().activeTurn).toBeNull();
  });
});

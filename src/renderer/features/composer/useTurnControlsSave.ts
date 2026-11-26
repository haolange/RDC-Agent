import { useCallback, useEffect, useState } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { persistSessionTurnControls } from './sessionModelOverride';
import type { ConversationTurnControls } from '@shared/types/modelCapability';

const IDLE_SAVE: { saving: boolean; error?: string } = { saving: false };

/** Saves a session's turn controls and reports the newest save while that session is shown. */
export function useTurnControlsSave(sessionId: string | null) {
  const [saveState, setSaveState] = useState<{ sessionId: string | null; saving: boolean; error?: string }>({
    sessionId,
    saving: false,
  });
  useEffect(() => {
    setSaveState({ sessionId, saving: false });
  }, [sessionId]);
  const saveControls = useCallback(
    async (controls: ConversationTurnControls) => {
      if (!sessionId) return;
      setSaveState({ sessionId, saving: true });
      const result = await persistSessionTurnControls(sessionId, controls);
      // Only the newest save of the session's controls (its revision lane) speaks for them, while that session shows.
      if (result.latest && useProjectStore.getState().currentSessionId === sessionId) {
        setSaveState({ sessionId, saving: false, error: result.ok ? undefined : result.error });
      }
    },
    [sessionId],
  );
  return { saveState: saveState.sessionId === sessionId ? saveState : IDLE_SAVE, saveControls };
}

import { createContext, useContext, type ReactNode } from 'react';
import type { SessionRecord } from '@shared/types/session';
import { useTurnControls } from './useTurnControls';

const Context = createContext<ReturnType<typeof useTurnControls> | null>(null);

/** One owner survives switching between the editor and a plan review revision. */
export function ComposerTurnControlsProvider({ agentId, currentSession, children }: {
  agentId: string; currentSession: SessionRecord | null; children: ReactNode;
}) {
  const controls = useTurnControls(agentId, currentSession);
  return <Context.Provider value={controls}>{children}</Context.Provider>;
}

export function useComposerTurnControls() {
  const controls = useContext(Context);
  if (!controls) throw new Error('Composer controls require ComposerTurnControlsProvider');
  return controls;
}

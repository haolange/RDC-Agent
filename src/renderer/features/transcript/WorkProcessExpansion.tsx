import React from 'react';
import { useAppSettingsStore } from '../../stores/appSettingsStore';
import type { WorkProcessExpansion as WorkProcessExpansionPreference } from '@shared/types/settings';

interface WorkProcessExpansionState {
  preference: WorkProcessExpansionPreference;
  /** The owning process (turn or delegation) is still running. */
  active: boolean;
  /** The step that is running now, when the process is active. */
  latestSectionId?: string;
}

const ExpansionContext = React.createContext<WorkProcessExpansionState>({ preference: 'latest', active: false });

/** Each process body (the turn's Working, an opened delegation) supplies its own activity and latest step. */
export const WorkProcessExpansionProvider: React.FC<{ active: boolean; latestSectionId?: string; children: React.ReactNode }> = ({
  active, latestSectionId, children,
}) => {
  const preference = useAppSettingsStore((state) => state.settings.appearance.workProcessExpansion);
  const value = React.useMemo(() => ({ preference, active, latestSectionId }), [preference, active, latestSectionId]);
  return <ExpansionContext.Provider value={value}>{children}</ExpansionContext.Provider>;
};

export function useWorkProcessExpansion(): WorkProcessExpansionState {
  return React.useContext(ExpansionContext);
}

import { createContext, useContext, type RefObject } from 'react';

/** Owned by the workbench; features consume geometry without importing each other. */
export interface WorkbenchReadingLayout {
  workArea: RefObject<HTMLElement>;
  composerRail: RefObject<HTMLDivElement>;
}

export const WorkbenchReadingLayoutContext = createContext<WorkbenchReadingLayout | null>(null);
export const useWorkbenchReadingLayout = () => useContext(WorkbenchReadingLayoutContext);

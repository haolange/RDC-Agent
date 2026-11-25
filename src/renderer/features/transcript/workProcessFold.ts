import { createContext, useContext } from 'react';

/**
 * Whether the enclosing Working is folded. Its body is not displayed then (the reply renders below Working), so row
 * lists mount nothing while folded; a 300-step turn costs no DOM until it is opened.
 */
const WorkProcessFoldContext = createContext(false);

export const WorkProcessFoldProvider = WorkProcessFoldContext.Provider;

export const useWorkProcessFolded = (): boolean => useContext(WorkProcessFoldContext);

import { createContext, useContext } from 'react';

/**
 * Whether the enclosing Working is folded. A folded Working hides every row but the reply, so measured windowing
 * would keep spacers for rows that no longer take space and could leave the reply outside the rendered range.
 */
const WorkProcessFoldContext = createContext(false);

export const WorkProcessFoldProvider = WorkProcessFoldContext.Provider;

export const useWorkProcessFolded = (): boolean => useContext(WorkProcessFoldContext);

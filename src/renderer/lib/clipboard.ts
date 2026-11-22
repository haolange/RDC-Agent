import { createContext, useContext } from 'react';

/**
 * Writes text to the system clipboard and reports whether it was accepted. The application provides the writer
 * (it owns the shell bridge); presentation components only ask for it.
 */
export type CopyText = (text: string) => Promise<boolean>;

const refuseCopy: CopyText = async () => false;

export const ClipboardContext = createContext<CopyText>(refuseCopy);

export const useCopyText = (): CopyText => useContext(ClipboardContext);

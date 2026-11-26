import { createContext, useContext } from 'react';
import type { ComposerController } from './useComposer';
import type { useSlashCommand } from './useSlashCommand';
import type { SessionRecord } from '@shared/types/session';

export type ComposerMarkdownMode = 'write' | 'preview';

/** What the Composer's parts read: the controller and what the shell derives from the current session around it. */
export interface ComposerView {
  composer: ComposerController;
  currentSession: SessionRecord | null;
  /** The Agent of the turn running in this session, when one runs. */
  activeAgentId: string | null;
  /** Project and session the draft belongs to; a new scope remounts the input. */
  scopeKey: string;
  markdown: boolean;
  markdownMode: ComposerMarkdownMode;
  slashCommand: ReturnType<typeof useSlashCommand>;
  /** Announced while a send prepares or a handoff switches Agents. */
  transitionLabel: string;
  visionSupported: boolean;
}

const ComposerViewContext = createContext<ComposerView | null>(null);

export const ComposerViewProvider = ComposerViewContext.Provider;

export function useComposerView(): ComposerView {
  const view = useContext(ComposerViewContext);
  if (!view) throw new Error('Composer parts require ComposerViewProvider');
  return view;
}

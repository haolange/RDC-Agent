import { useComposerSessionContextStore } from '../../stores/composerSessionContextStore';
import { useConversationStore } from '../../stores/conversationStore';
import { useSessionStore } from '../../stores/sessionStore';
import type { RunSummary } from '@shared/types/session';

const ACTIVE_RUN_STATUSES: ReadonlySet<RunSummary['status']> = new Set([
  'planning',
  'awaiting_input',
  'awaiting_approval',
  'queued',
  'running',
  'stopping',
]);

/** A debug Run main still projects as in progress. */
export function isActiveRun(run: RunSummary | null): boolean {
  return !!run && ACTIVE_RUN_STATUSES.has(run.status);
}

/**
 * Whether no conversation turn or debug Run is starting or running, read from the stores at call time rather than
 * from the last render, so a continuation started from a store subscription sees the turn that just ended as ended.
 */
export function isComposerExecutionIdle(): boolean {
  const context = useComposerSessionContextStore.getState();
  return (
    !context.activeTurn &&
    !context.isPromptSending &&
    !isActiveRun(useSessionStore.getState().currentRun) &&
    !useConversationStore
      .getState()
      .conversationMessages.some(
        (message) => message.role === 'assistant' && (message.status === 'draft' || message.status === 'streaming'),
      )
  );
}

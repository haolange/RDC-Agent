import { useLayoutEffect, useState } from 'react';
import { useConversationStore } from '../../stores/conversationStore';
import type { ComposerPendingRequestState } from './pendingRequestSelection';

/**
 * Height the Composer keeps for a request it just answered. While the turn that asked (an approval, a question, a plan
 * review) is still running, the next request of that turn takes the same place, so answering does not drop the
 * Composer and raise it again. The reserve ends with that turn: the Composer settles back once, when the turn is done.
 */
export function useComposerRequestReserve(pending: ComposerPendingRequestState | null, requestShell: HTMLElement | null): number {
  const [reserve, setReserve] = useState<{ turnId: string; height: number } | null>(null);
  const pendingTurnId = pending?.request.turnId ?? null;
  useLayoutEffect(() => {
    if (!pendingTurnId || !requestShell) return undefined;
    const measure = () => {
      const height = Math.round(requestShell.getBoundingClientRect().height);
      setReserve((current) => (current?.turnId === pendingTurnId && current.height === height ? current : { turnId: pendingTurnId, height }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(requestShell);
    return () => observer.disconnect();
  }, [pendingTurnId, requestShell]);
  const reservedTurnId = reserve?.turnId ?? null;
  const turnRunning = useConversationStore((state) => reservedTurnId !== null && state.conversationMessages.some((message) => (
    message.turnId === reservedTurnId && message.role === 'assistant' && (message.status === 'streaming' || message.status === 'draft'))));
  return pending || !reserve || !turnRunning ? 0 : reserve.height;
}

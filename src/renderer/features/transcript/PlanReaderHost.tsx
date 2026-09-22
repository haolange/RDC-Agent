import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import type { ConversationPlanReview } from '@shared/types/planReview';
import { PlanReviewPanel } from './PlanReviewPanel';
import { useProjectStore } from '../../stores/projectStore';

const PlanReaderContext = createContext<((plan: ConversationPlanReview) => void) | null>(null);

/** Keep the reader alive when transcript rows remount during layout changes. */
export function PlanReaderHost({ children }: { children: ReactNode }) {
  const [plan, setPlan] = useState<ConversationPlanReview | null>(null);
  const opened = useRef<{ planId: string; sessionId: string | undefined } | null>(null);
  const open = useCallback((next: ConversationPlanReview) => {
    opened.current = { planId: next.planId, sessionId: useProjectStore.getState().currentSession?.sessionId };
    setPlan(next);
  }, []);
  const close = useCallback(() => {
    const target = opened.current;
    setPlan(null);
    requestAnimationFrame(() => {
      if (!target || useProjectStore.getState().currentSession?.sessionId !== target.sessionId) return;
      // The original trigger may have remounted while the reader stayed open.
      Array.from(document.querySelectorAll<HTMLButtonElement>('button[data-plan-id]'))
        .find((button) => button.dataset.planId === target.planId)?.focus({ preventScroll: true });
    });
  }, []);
  return (
    <PlanReaderContext.Provider value={open}>
      {children}
      {plan ? <PlanReviewPanel plan={plan} onClose={close} /> : null}
    </PlanReaderContext.Provider>
  );
}

export function usePlanReader() {
  const open = useContext(PlanReaderContext);
  if (!open) throw new Error('PlanReaderHost is required for plan cards.');
  return open;
}

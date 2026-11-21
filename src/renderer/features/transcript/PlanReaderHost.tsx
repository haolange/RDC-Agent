import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { PlanReviewPanel } from './PlanReviewPanel';
import type { ConversationPlanReview } from '@shared/types/planReview';

const PlanReaderContext = createContext<((plan: ConversationPlanReview) => void) | null>(null);

/** Keep the reader alive when transcript rows remount during layout changes. */
export function PlanReaderHost({ children }: { children: ReactNode }) {
  const [plan, setPlan] = useState<ConversationPlanReview | null>(null);
  const [readerOpen, setReaderOpen] = useState(false);
  const opened = useRef<{ planId: string; sessionId: string | undefined } | null>(null);
  const open = useCallback((next: ConversationPlanReview) => {
    opened.current = { planId: next.planId, sessionId: useProjectStore.getState().currentSession?.sessionId };
    setPlan(next);
    setReaderOpen(true);
  }, []);
  const close = useCallback(() => {
    const target = opened.current;
    setReaderOpen(false);
    requestAnimationFrame(() => {
      if (!target || useProjectStore.getState().currentSession?.sessionId !== target.sessionId) return;
      // The original trigger may have remounted while the reader stayed open.
      Array.from(document.querySelectorAll<HTMLElement>('[data-plan-id]'))
        .find((button) => button.dataset.planId === target.planId)?.focus({ preventScroll: true });
    });
  }, []);
  const dropPlan = useCallback(() => setPlan(null), []);
  return (
    <PlanReaderContext.Provider value={open}>
      {children}
      {plan ? <PlanReviewPanel open={readerOpen} plan={plan} onClose={close} onExited={dropPlan} /> : null}
    </PlanReaderContext.Provider>
  );
}

export function usePlanReader() {
  const open = useContext(PlanReaderContext);
  if (!open) throw new Error('PlanReaderHost is required for plan cards.');
  return open;
}

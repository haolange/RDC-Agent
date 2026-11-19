import { HandoffActionRow } from '../../patterns/HandoffActionRow/HandoffActionRow';
import { useComposerSessionContextStore } from '../../stores/composerSessionContextStore';
import { usePlanReviewStore } from '../../stores/planReviewStore';
import { useI18n } from '../../i18n';

/** An explicit continuation of the exact, still-unsent approved plan. */
export function ApprovedPlanHandoff({ sessionId, disabled }: { sessionId?: string | null; disabled: boolean }) {
  const { t } = useI18n();
  const handoff = usePlanReviewStore(state => sessionId ? state.bySession[sessionId]?.approvedHandoff : undefined);
  const queued = useComposerSessionContextStore(state => !!state.handoffSuggestionRequest);
  if (!sessionId || !handoff) return null;
  return <section aria-label={t('chat.approvedPlanReady')}>
    <p>{t('chat.approvedPlanReady')}</p>
    <HandoffActionRow options={[handoff]} disabled={disabled || queued} onSelect={() => {
      useComposerSessionContextStore.getState().queueHandoffSuggestion({ sessionId, agentId: handoff.agent,
        label: handoff.label, prompt: handoff.prompt, send: handoff.send, approvedPlanHash: handoff.planHash });
    }} />
  </section>;
}

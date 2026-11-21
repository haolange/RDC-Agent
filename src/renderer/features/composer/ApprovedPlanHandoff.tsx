import { HandoffActionRow } from '../../patterns/HandoffActionRow/HandoffActionRow';
import { useComposerSessionContextStore } from '../../stores/composerSessionContextStore';
import { usePlanReviewStore } from '../../stores/planReviewStore';
import { useI18n } from '../../i18n';
import { Icon } from '../../ui/Icon';

/**
 * An explicit continuation of the exact, still-unsent approved plan. It reads like the plan reference card the sent
 * message will become: what it is, the plan's title, then the continuation actions.
 */
export function ApprovedPlanHandoff({ sessionId, disabled }: { sessionId?: string | null; disabled: boolean }) {
  const { t } = useI18n();
  const handoff = usePlanReviewStore(state => sessionId ? state.bySession[sessionId]?.approvedHandoff : undefined);
  const queued = useComposerSessionContextStore(state => !!state.handoffSuggestionRequest);
  if (!sessionId || !handoff) return null;
  return <section className="composer-approved-plan" aria-label={t('chat.approvedPlanReady')}>
    <span className="composer-approved-plan-kind"><Icon name="play" size={14} />{t('chat.approvedPlanReady')}</span>
    {handoff.planTitle ? <span className="composer-approved-plan-title">{handoff.planTitle}</span> : null}
    <HandoffActionRow options={[handoff]} disabled={disabled || queued} onSelect={() => {
      useComposerSessionContextStore.getState().queueHandoffSuggestion({ sessionId, agentId: handoff.agent,
        label: handoff.label, prompt: handoff.prompt, send: handoff.send, approvedPlan: { planId: handoff.planId, revision: handoff.revision, hash: handoff.planHash } });
    }} />
  </section>;
}

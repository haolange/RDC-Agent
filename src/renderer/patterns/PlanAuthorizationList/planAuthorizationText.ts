import type { PlanAuthorization } from '@shared/types/planInvestigation';
import type { Translator } from '../../i18n/messages';

const KNOWN_EFFECTS = new Set(['shader_replacement']);
const KNOWN_STAGES = new Set(['vs', 'hs', 'ds', 'gs', 'ps', 'cs', 'ms', 'as']);

/**
 * One approved intervention in the reader's words: what changes and on which object, then how many times and how it
 * stays recoverable. Catalog names and identifiers stay out of the sentence.
 */
export function planAuthorizationText(item: PlanAuthorization, t: Translator): { title: string; detail: string } {
  const action = KNOWN_EFFECTS.has(item.effect)
    ? t(`chat.planAuthorizationEffect.${item.effect as 'shader_replacement'}`)
    : t('chat.planAuthorizationEffectOther');
  const target = [
    item.target.eventId !== undefined ? t('chat.planAuthorizationEvent', { event: item.target.eventId }) : '',
    item.target.stage
      ? KNOWN_STAGES.has(item.target.stage)
        ? t(`chat.planAuthorizationStage.${item.target.stage as 'ps'}`)
        : t('chat.planAuthorizationStageOther')
      : '',
    item.target.shaderId ? t('chat.planAuthorizationShader') : '',
  ].filter(Boolean);
  return {
    title: [action, ...target].join(t('chat.planAuthorizationJoin')),
    detail: [
      t('chat.planAuthorizationCount', { count: item.maxInstances }),
      t(
        item.reversibility === 'rollback-before-next'
          ? 'chat.planAuthorizationRevertBeforeNext'
          : 'chat.planAuthorizationReversible',
      ),
    ].join(t('chat.listSeparator')),
  };
}

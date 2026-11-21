import type { Translator } from '../../i18n/messages';

/** Placeholder and button names for the Composer, in the interface language. */
export function buildComposerPresentation(input: {
  t: Translator;
  currentModeLabel: string;
  /** The Agent's own "what to tell me", already in the interface language; empty when it declares none. */
  currentModeHint: string;
  hasProject: boolean;
  hasActiveDebugRun: boolean;
  isComposerBusy: boolean;
}) {
  const { t, currentModeLabel: agent } = input;
  const hint = input.currentModeHint.trim();
  const stopLabel = t(input.hasActiveDebugRun ? 'composer.stopDebugRun' : 'composer.stopRequest');
  return {
    promptPlaceholder: hint ? t('composer.placeholderHint', { agent, hint }) : t('composer.placeholder', { agent }),
    attachButtonLabel: t(input.hasProject ? 'composer.attach' : 'composer.attachNeedsProject'),
    primaryButtonDescription: input.isComposerBusy ? stopLabel : t('composer.sendTo', { agent }),
  };
}

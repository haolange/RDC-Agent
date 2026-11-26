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
  /** Stop was pressed and main has not answered yet. */
  stopPending: boolean;
}) {
  const { t, currentModeLabel: agent } = input;
  const hint = input.currentModeHint.trim();
  const stopLabel = t(input.hasActiveDebugRun ? 'composer.stopDebugRun' : 'composer.stopRequest');
  return {
    // The Agent pill already names who receives the message; the placeholder only says what to tell it.
    promptPlaceholder: hint ? t('composer.placeholderHint', { hint }) : t('composer.placeholder', { agent }),
    attachButtonLabel: t(input.hasProject ? 'composer.attach' : 'composer.attachNeedsProject'),
    primaryButtonDescription: input.stopPending
      ? t('composer.stopping')
      : input.isComposerBusy
        ? stopLabel
        : t('composer.sendTo', { agent }),
  };
}

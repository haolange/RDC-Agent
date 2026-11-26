import type { Translator } from '../../i18n/messages';
import type { ConversationMessage, ConversationMessageDiagnostic } from '@shared/types/conversation';

export type SystemNoticeTone = 'neutral' | 'warning' | 'error';

export function resolveSystemNoticeTone(message: ConversationMessage): SystemNoticeTone {
  if (message.diagnostic) {
    return message.diagnostic.severity;
  }
  return message.status === 'error' ? 'error' : 'neutral';
}

/** Slash-command results carry a `kind: 'command'` work-trace block whose title is `/help`. */
export function resolveCommandLabel(message: ConversationMessage): string | null {
  const title = message.workTrace?.blocks.find((block) => block.kind === 'command')?.title.trim();
  return title ? title : null;
}

/** The model-switch notice is localized from its structured count; every other notice keeps its stored text. */
export function resolveSystemNoticeText(message: ConversationMessage, t: Translator): string {
  if (message.diagnostic?.code !== 'MODEL_CONTINUATION_DROPPED') return message.content;
  return t('chat.modelContinuationDropped', { count: message.diagnostic.continuationDrop.count });
}

/** An interrupted turn is worded from its recorded cause; every other diagnostic keeps the sentence main gave it. */
export function resolveDiagnosticText(diagnostic: ConversationMessageDiagnostic, t: Translator): string {
  if (diagnostic.code !== 'CONVERSATION_INTERRUPTED') return diagnostic.userMessage;
  return t(`chat.interruptedTurn.${diagnostic.interruption.cause}`);
}

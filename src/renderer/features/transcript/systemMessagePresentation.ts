import type { ConversationMessage } from '@shared/types/conversation';

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

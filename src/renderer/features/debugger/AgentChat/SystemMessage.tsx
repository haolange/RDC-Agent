import React from 'react';
import type { ConversationMessage } from '@shared/types/conversation';
import { useI18n } from '../../../i18n';
import { MessageMarkdown } from './MessageMarkdown';
import { resolveCommandLabel, resolveSystemNoticeTone } from './systemMessagePresentation';

interface SystemMessageProps {
  message: ConversationMessage;
}

export const SystemMessage: React.FC<SystemMessageProps> = ({ message }) => {
  const { t } = useI18n();
  const tone = resolveSystemNoticeTone(message);
  const commandLabel = resolveCommandLabel(message);
  const text = message.diagnostic?.code === 'MODEL_CONTINUATION_DROPPED'
    ? t('chat.modelContinuationDropped')
    : message.content;
  const toneLabel = tone === 'error'
    ? t('chat.messageError')
    : tone === 'warning'
      ? t('chat.messageWarning')
      : undefined;
  const liveRole = tone === 'error' ? 'alert' : 'status';

  if (commandLabel) {
    return (
      <article
        className="conversation-message conversation-message-system is-command"
        data-testid="message-bubble-system"
        data-message-id={message.id}
      >
        <div
          className={`conversation-bubble-system is-command severity-${tone}`}
          role={liveRole}
        >
          <span className="conversation-system-command-label">{commandLabel}</span>
          <div className="conversation-system-command-body">
            <MessageMarkdown content={text} />
          </div>
        </div>
      </article>
    );
  }

  return (
    <article
      className="conversation-message conversation-message-system"
      data-testid="message-bubble-system"
      data-message-id={message.id}
    >
      <div className={`conversation-bubble-system severity-${tone}`} role={liveRole}>
        <span
          className="conversation-system-dot"
          aria-hidden={toneLabel ? undefined : true}
          aria-label={toneLabel}
        />
        <span className="conversation-system-text">{text}</span>
      </div>
    </article>
  );
};

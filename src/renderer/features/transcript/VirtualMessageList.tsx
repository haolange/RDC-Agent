/** Windowed messages with measured row heights, including expanded work cards. */
import React, { useMemo } from 'react';
import { useWindowedList } from '../../lib/useWindowedList';
import { WindowedListSpacer } from '../../lib/WindowedListSpacer';
import type { ConversationMessage } from '@shared/types/conversation';

const VIRTUALIZE_THRESHOLD = 48;
const SPACER_CLASS = 'conversation-thread-spacer';
const transcriptScroller = (list: HTMLElement) => list.closest<HTMLElement>('.chat-messages');

interface Props {
  messages: ConversationMessage[];
  renderMessage: (msg: ConversationMessage, index: number) => React.ReactNode;
  estimateHeight?: number;
  overscan?: number;
  className?: string;
  'data-testid'?: string;
}

/** Rows are keyed by message id: a send's messages carry main's ids from the start, so a row keeps its height and DOM. */
export const VirtualMessageList: React.FC<Props> = ({
  messages, renderMessage, estimateHeight = 160, overscan = 6, className, 'data-testid': testId,
}) => {
  const keys = useMemo(() => messages.map((message) => message.id), [messages]);
  const virtualized = messages.length > VIRTUALIZE_THRESHOLD;
  const { listRef, range, offsets } = useWindowedList<HTMLOListElement>({
    keys, enabled: virtualized, estimate: estimateHeight, overscan, initialCount: 24,
    scrollerOf: transcriptScroller, spacerClassName: SPACER_CLASS,
  });
  const item = (message: ConversationMessage, index: number) => <li key={message.id} className="conversation-thread-item"
    data-message-role={message.role} data-message-status={message.status ?? 'complete'}>{renderMessage(message, index)}</li>;

  if (!virtualized) return <ol ref={listRef} className={className} data-testid={testId}
    data-message-count={messages.length} data-virtualized="false">{messages.map(item)}</ol>;

  return <ol ref={listRef} className={`${className ?? ''} conversation-thread-virtual`.trim()}
    data-testid={testId} data-message-count={messages.length} data-virtualized="true">
    <WindowedListSpacer className={SPACER_CLASS} height={offsets[range.start] ?? 0} />
    {messages.slice(range.start, range.end).map((message, index) => item(message, range.start + index))}
    <WindowedListSpacer className={SPACER_CLASS} height={offsets[messages.length] - (offsets[range.end] ?? 0)} />
  </ol>;
};

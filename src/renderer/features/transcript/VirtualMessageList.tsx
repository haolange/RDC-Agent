/** Windowed messages with measured row heights, including expanded work cards. */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useDynStyle } from '../../lib/useDynStyle';
import type { ConversationMessage } from '@shared/types/conversation';

const VIRTUALIZE_THRESHOLD = 48;

interface Props {
  messages: ConversationMessage[];
  renderMessage: (msg: ConversationMessage, index: number) => React.ReactNode;
  estimateHeight?: number;
  overscan?: number;
  className?: string;
  'data-testid'?: string;
}

export function measuredMessageOffsets(messages: readonly Pick<ConversationMessage, 'id'>[], heights: ReadonlyMap<string, number>, estimate: number): number[] {
  const offsets = [0];
  for (const message of messages) offsets.push(offsets[offsets.length - 1] + (heights.get(message.id) ?? estimate));
  return offsets;
}

function indexAtOffset(offsets: number[], value: number): number {
  let low = 0;
  let high = offsets.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high + 1) / 2);
    if (offsets[middle] <= value) low = middle;
    else high = middle - 1;
  }
  return Math.min(low, offsets.length - 2);
}

const VirtualSpacer: React.FC<{ height: number }> = ({ height }) => {
  const dynStyle = useDynStyle({ height: `${height}px` });
  return <li aria-hidden="true" className="conversation-thread-spacer" {...dynStyle} />;
};

const VirtualMessageItem: React.FC<{
  msg: ConversationMessage;
  index: number;
  renderMessage: Props['renderMessage'];
  onHeight: (id: string, height: number) => void;
}> = ({ msg, index, renderMessage, onHeight }) => {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => onHeight(msg.id, element.getBoundingClientRect().height));
    observer.observe(element);
    return () => observer.disconnect();
  }, [msg.id, onHeight]);
  return <li ref={ref} className="conversation-thread-item" data-message-role={msg.role}
    data-message-status={msg.status ?? 'complete'}>{renderMessage(msg, index)}</li>;
};

export const VirtualMessageList: React.FC<Props> = ({
  messages, renderMessage, estimateHeight = 160, overscan = 6, className, 'data-testid': testId,
}) => {
  const listRef = useRef<HTMLOListElement>(null);
  const heights = useRef(new Map<string, number>());
  const [heightRevision, setHeightRevision] = useState(0);
  const [range, setRange] = useState({ start: 0, end: Math.min(messages.length, 24) });
  const offsets = measuredMessageOffsets(messages, heights.current, estimateHeight);
  const offsetsRef = useRef(offsets);
  offsetsRef.current = offsets;
  const rangeRef = useRef(range);
  rangeRef.current = range;
  // Read through a ref so the callback stays the same while messages stream; a new callback would make every visible
  // item drop and recreate its ResizeObserver on each update.
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const onHeight = useCallback((id: string, height: number) => {
    if (!Number.isFinite(height) || height <= 0) return;
    const previous = heights.current.get(id);
    if (previous !== undefined && Math.abs(previous - height) < 1) return;
    const index = messagesRef.current.findIndex((message) => message.id === id);
    if (index < 0) return;
    heights.current.set(id, height);
    const parent = listRef.current?.closest('.chat-messages') as HTMLElement | null;
    if (parent && index < rangeRef.current.start) parent.scrollTop += height - (previous ?? estimateHeight);
    setHeightRevision((revision) => revision + 1);
  }, [estimateHeight]);

  const updateRange = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const parent = list.closest('.chat-messages') as HTMLElement | null;
    if (!parent || messages.length <= VIRTUALIZE_THRESHOLD) {
      setRange((previous) => previous.start === 0 && previous.end === messages.length ? previous : { start: 0, end: messages.length });
      return;
    }
    const listTop = list.getBoundingClientRect().top - parent.getBoundingClientRect().top + parent.scrollTop;
    const viewStart = Math.max(0, parent.scrollTop - listTop);
    const viewEnd = viewStart + parent.clientHeight;
    const start = Math.max(0, indexAtOffset(offsetsRef.current, viewStart) - overscan);
    const end = Math.min(messages.length, indexAtOffset(offsetsRef.current, viewEnd) + overscan + 1);
    setRange((previous) => previous.start === start && previous.end === end ? previous : { start, end });
  }, [messages.length, overscan]);

  useEffect(() => {
    const parent = listRef.current?.closest('.chat-messages') as HTMLElement | null;
    if (!parent) { updateRange(); return; }
    parent.addEventListener('scroll', updateRange, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateRange);
    observer?.observe(parent);
    updateRange();
    return () => { parent.removeEventListener('scroll', updateRange); observer?.disconnect(); };
  }, [updateRange]);
  useEffect(updateRange, [messages.length, heightRevision, updateRange]);

  if (messages.length <= VIRTUALIZE_THRESHOLD) return <ol ref={listRef} className={className} data-testid={testId}
    data-message-count={messages.length} data-virtualized="false">{messages.map((message, index) =>
      <li key={message.id} className="conversation-thread-item" data-message-role={message.role}
        data-message-status={message.status ?? 'complete'}>{renderMessage(message, index)}</li>)}</ol>;

  const visible = messages.slice(range.start, range.end);
  return <ol ref={listRef} className={`${className ?? ''} conversation-thread-virtual`.trim()}
    data-testid={testId} data-message-count={messages.length} data-virtualized="true">
    <VirtualSpacer height={offsets[range.start] ?? 0} />
    {visible.map((message, index) => <VirtualMessageItem key={message.id} msg={message} index={range.start + index}
      renderMessage={renderMessage} onHeight={onHeight} />)}
    <VirtualSpacer height={Math.max(0, offsets[messages.length] - (offsets[range.end] ?? 0))} />
  </ol>;
};

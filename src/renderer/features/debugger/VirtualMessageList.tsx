/**
 * VirtualMessageList — 虚拟滚动消息列表。
 *
 * 挂在外层 `.chat-messages` 滚动容器上，仅渲染可视区 ± overscan。
 * 短列表（≤ VIRTUALIZE_THRESHOLD）全量渲染以保持布局保真。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
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

export const VirtualMessageList: React.FC<Props> = ({
  messages,
  renderMessage,
  estimateHeight = 160,
  overscan = 6,
  className,
  'data-testid': testId,
}) => {
  const listRef = useRef<HTMLOListElement>(null);
  const [range, setRange] = useState({ start: 0, end: Math.min(messages.length, 24) });

  const updateRange = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const scrollParent = list.closest('.chat-messages') as HTMLElement | null;
    if (!scrollParent || messages.length <= VIRTUALIZE_THRESHOLD) {
      setRange({ start: 0, end: messages.length });
      return;
    }
    const parentRect = scrollParent.getBoundingClientRect();
    const listRect = list.getBoundingClientRect();
    const offsetWithinScroll = listRect.top - parentRect.top + scrollParent.scrollTop;
    const viewStart = scrollParent.scrollTop - offsetWithinScroll;
    const viewEnd = viewStart + scrollParent.clientHeight;
    const start = Math.max(0, Math.floor(viewStart / estimateHeight) - overscan);
    const end = Math.min(
      messages.length,
      Math.ceil(viewEnd / estimateHeight) + overscan,
    );
    setRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, [messages.length, estimateHeight, overscan]);

  useEffect(() => {
    const list = listRef.current;
    const scrollParent = list?.closest('.chat-messages') as HTMLElement | null;
    if (!scrollParent) {
      updateRange();
      return;
    }
    scrollParent.addEventListener('scroll', updateRange, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => updateRange())
      : null;
    ro?.observe(scrollParent);
    updateRange();
    return () => {
      scrollParent.removeEventListener('scroll', updateRange);
      ro?.disconnect();
    };
  }, [updateRange]);

  useEffect(() => {
    updateRange();
  }, [messages.length, updateRange]);

  if (messages.length <= VIRTUALIZE_THRESHOLD) {
    return (
      <ol
        ref={listRef}
        className={className}
        data-testid={testId}
        data-message-count={messages.length}
        data-virtualized="false"
      >
        {messages.map((msg, index) => (
          <li
            key={msg.id}
            className="conversation-thread-item"
            data-message-role={msg.role}
            data-message-status={msg.status ?? 'complete'}
          >
            {renderMessage(msg, index)}
          </li>
        ))}
      </ol>
    );
  }

  const totalHeight = messages.length * estimateHeight;
  const offsetY = range.start * estimateHeight;
  const visible = messages.slice(range.start, range.end);

  return (
    <ol
      ref={listRef}
      className={className}
      data-testid={testId}
      data-message-count={messages.length}
      data-virtualized="true"
      style={{ position: 'relative', height: totalHeight, gap: 0 }}
    >
      <li
        aria-hidden="true"
        className="conversation-thread-spacer"
        style={{
          display: 'block',
          height: offsetY,
          margin: 0,
          padding: 0,
          listStyle: 'none',
          pointerEvents: 'none',
        }}
      />
      {visible.map((msg, i) => {
        const index = range.start + i;
        return (
          <li
            key={msg.id}
            className="conversation-thread-item"
            data-message-role={msg.role}
            data-message-status={msg.status ?? 'complete'}
            style={{ minHeight: estimateHeight }}
          >
            {renderMessage(msg, index)}
          </li>
        );
      })}
      <li
        aria-hidden="true"
        className="conversation-thread-spacer"
        style={{
          display: 'block',
          height: Math.max(0, totalHeight - offsetY - visible.length * estimateHeight),
          margin: 0,
          padding: 0,
          listStyle: 'none',
          pointerEvents: 'none',
        }}
      />
    </ol>
  );
};

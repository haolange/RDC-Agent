/**
 * VirtualMessageList — 虚拟滚动消息列表。
 *
 * 挂在外层 `.chat-messages` 滚动容器上，仅渲染可视区 ± overscan。
 * 短列表（≤ VIRTUALIZE_THRESHOLD）全量渲染以保持布局保真。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ConversationMessage } from '@shared/types/conversation';
import { useDynStyle } from '../../lib/useDynStyle';
import { findToolCallMessage } from '../../lib/findToolCallMessage';

const VIRTUALIZE_THRESHOLD = 48;

interface Props {
  messages: ConversationMessage[];
  renderMessage: (msg: ConversationMessage, index: number) => React.ReactNode;
  estimateHeight?: number;
  overscan?: number;
  className?: string;
  'data-testid'?: string;
}

const VirtualSpacer: React.FC<{ height: number }> = ({ height }) => {
  const dynStyle = useDynStyle({ height: `${height}px` });
  return (
    <li
      aria-hidden="true"
      className="conversation-thread-spacer"
      {...dynStyle}
    />
  );
};

const VirtualMessageItem: React.FC<{
  msg: ConversationMessage;
  index: number;
  estimateHeight: number;
  renderMessage: (msg: ConversationMessage, index: number) => React.ReactNode;
}> = ({ msg, index, estimateHeight, renderMessage }) => {
  const dynStyle = useDynStyle({ 'min-height': `${estimateHeight}px` });
  return (
    <li
      className="conversation-thread-item"
      data-message-role={msg.role}
      data-message-status={msg.status ?? 'complete'}
      {...dynStyle}
    >
      {renderMessage(msg, index)}
    </li>
  );
};

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

  useEffect(() => {
    let frame: number | undefined;
    const locate = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId: string; sessionId: string; toolCallId: string }>).detail;
      if (!detail) return;
      const index = findToolCallMessage(messages, detail);
      if (index < 0) return;
      const list = listRef.current;
      const parent = list?.closest('.chat-messages') as HTMLElement | null;
      if (!list || !parent) return;
      if (frame !== undefined) cancelAnimationFrame(frame);
      if (messages.length > VIRTUALIZE_THRESHOLD) {
        parent.scrollTop = list.getBoundingClientRect().top - parent.getBoundingClientRect().top + parent.scrollTop + index * estimateHeight;
        setRange({ start: Math.max(0, index - overscan), end: Math.min(messages.length, index + overscan + 1) });
      }
      frame = requestAnimationFrame(() => {
        frame = undefined;
        const target = Array.from(list.querySelectorAll<HTMLElement>('[data-message-id]')).find((item) => item.dataset.messageId === messages[index].id);
        target?.scrollIntoView({ block: 'center', behavior: 'auto' });
        if (target) { target.tabIndex = -1; target.focus({ preventScroll: true }); }
      });
    };
    window.addEventListener('rdc:locate-tool-call', locate);
    return () => { window.removeEventListener('rdc:locate-tool-call', locate); if (frame !== undefined) cancelAnimationFrame(frame); };
  }, [messages, estimateHeight, overscan]);

  const totalHeight = messages.length * estimateHeight;
  const listDynStyle = useDynStyle(
    messages.length > VIRTUALIZE_THRESHOLD
      ? { height: `${totalHeight}px` }
      : {},
  );

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

  const offsetY = range.start * estimateHeight;
  const visible = messages.slice(range.start, range.end);
  const trailingHeight = Math.max(0, totalHeight - offsetY - visible.length * estimateHeight);

  return (
    <ol
      ref={listRef}
      className={`${className ?? ''} conversation-thread-virtual`.trim()}
      data-testid={testId}
      data-message-count={messages.length}
      data-virtualized="true"
      {...listDynStyle}
    >
      <VirtualSpacer height={offsetY} />
      {visible.map((msg, i) => {
        const index = range.start + i;
        return (
          <VirtualMessageItem
            key={msg.id}
            msg={msg}
            index={index}
            estimateHeight={estimateHeight}
            renderMessage={renderMessage}
          />
        );
      })}
      <VirtualSpacer height={trailingHeight} />
    </ol>
  );
};

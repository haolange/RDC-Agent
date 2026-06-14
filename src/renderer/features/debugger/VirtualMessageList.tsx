/**
 * VirtualMessageList — 虚拟滚动消息列表。
 *
 * 使用 CSS overflow-anchor + 懒渲染窗口优化长对话性能。
 * 仅渲染可视区域 ± overscan 的消息。
 */
import React, { useRef, useState, useEffect, useCallback } from 'react';
import type { ConversationMessage } from '@shared/types/conversation';

interface Props {
  messages: ConversationMessage[];
  renderMessage: (msg: ConversationMessage, index: number) => React.ReactNode;
  estimateHeight?: number;
  overscan?: number;
}

export const VirtualMessageList: React.FC<Props> = ({
  messages, renderMessage, estimateHeight = 120, overscan = 5,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState({ start: 0, end: 20 });

  const updateRange = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const scrollTop = el.scrollTop;
    const viewHeight = el.clientHeight;
    const start = Math.max(0, Math.floor(scrollTop / estimateHeight) - overscan);
    const end = Math.min(messages.length, Math.ceil((scrollTop + viewHeight) / estimateHeight) + overscan);
    setRange({ start, end });
  }, [messages.length, estimateHeight, overscan]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('scroll', updateRange, { passive: true });
    updateRange();
    return () => el.removeEventListener('scroll', updateRange);
  }, [updateRange]);

  const totalHeight = messages.length * estimateHeight;
  const offsetY = range.start * estimateHeight;

  return (
    <div ref={containerRef} style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div style={{ position: 'absolute', top: offsetY, left: 0, right: 0 }}>
          {messages.slice(range.start, range.end).map((msg, i) => (
            <div key={msg.id ?? range.start + i} style={{ minHeight: estimateHeight }}>
              {renderMessage(msg, range.start + i)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

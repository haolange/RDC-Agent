import React, { useLayoutEffect, useRef } from 'react';
import { assignDynStyle } from '../../../lib/useDynStyle';

interface AutosizeTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  maxHeight?: number;
}

export const AutosizeTextarea: React.FC<AutosizeTextareaProps> = ({
  maxHeight = 132,
  value,
  ...props
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const measuredValue = typeof value === 'string' || typeof value === 'number' ? String(value) : '';

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    assignDynStyle(textarea, { height: 'auto', 'overflow-y': 'hidden' });
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
    assignDynStyle(textarea, {
      height: `${nextHeight}px`,
      'overflow-y': textarea.scrollHeight > maxHeight ? 'auto' : 'hidden',
    });
  }, [maxHeight, measuredValue]);

  return <textarea {...props} ref={textareaRef} value={value} />;
};

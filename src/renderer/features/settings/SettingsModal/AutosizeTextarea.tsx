import React, { useLayoutEffect, useRef } from 'react';

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

    textarea.style.height = 'auto';
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [maxHeight, measuredValue]);

  return <textarea {...props} ref={textareaRef} value={value} />;
};

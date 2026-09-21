import { useLayoutEffect, useRef, useState } from 'react';
import { cn } from '../lib/cn';
import './OverflowFade.css';

export interface OverflowFadeProps {
  text: string;
  className?: string;
}

export function OverflowFade({ text, className }: OverflowFadeProps) {
  const textRef = useRef<HTMLSpanElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  useLayoutEffect(() => {
    const element = textRef.current;
    if (!element) return undefined;
    let active = true;

    const measure = () => {
      if (!active) return;
      setOverflowing(element.scrollWidth > element.clientWidth + 1);
    };
    measure();

    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(measure);
    resizeObserver?.observe(element);

    const fonts = document.fonts;
    fonts?.addEventListener?.('loadingdone', measure);
    void fonts?.ready?.then(measure);

    return () => {
      active = false;
      resizeObserver?.disconnect();
      fonts?.removeEventListener?.('loadingdone', measure);
    };
  }, [text]);

  return (
    <span
      ref={textRef}
      className={cn('ui-overflow-fade', overflowing && 'is-overflowing', className)}
      title={text}
    >
      {text}
    </span>
  );
}

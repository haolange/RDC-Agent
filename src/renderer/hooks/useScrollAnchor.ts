import { useCallback, useRef, type RefObject } from 'react';

export interface ScrollAnchorRef {
  scrollToBottom: (behavior?: ScrollBehavior) => void;
  isNearBottom: (thresholdPx?: number) => boolean;
}

export interface UseScrollAnchorResult {
  containerRef: RefObject<HTMLDivElement | null>;
  anchor: ScrollAnchorRef;
}

/** Stub hook for scroll anchoring on a scrollable message/list container. */
export const useScrollAnchor = (): UseScrollAnchorResult => {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const element = containerRef.current;
    if (!element) {
      return;
    }
    element.scrollTo({ top: element.scrollHeight, behavior });
  }, []);

  const isNearBottom = useCallback((thresholdPx = 48) => {
    const element = containerRef.current;
    if (!element) {
      return true;
    }
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    return distance <= thresholdPx;
  }, []);

  return {
    containerRef,
    anchor: { scrollToBottom, isNearBottom },
  };
};

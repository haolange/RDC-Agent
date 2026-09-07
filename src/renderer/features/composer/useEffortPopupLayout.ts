import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';

export function useEffortPopupLayout(options: {
  open: boolean;
  menuRef: RefObject<HTMLDivElement | null>;
  popupRef: RefObject<HTMLDivElement | null>;
  trackRef: RefObject<HTMLDivElement | null>;
  trackObserveKey: string;
}): {
  popupShift: number;
  trackWidthPx: number;
  positionTransitionsReady: boolean;
} {
  const { open, menuRef, popupRef, trackRef, trackObserveKey } = options;
  const [popupShift, setPopupShift] = useState(0);
  const [trackWidthPx, setTrackWidthPx] = useState(0);
  const [positionTransitionsReady, setPositionTransitionsReady] = useState(false);
  const popupShiftRef = useRef(0);
  const trackWidthRef = useRef(0);
  const settleFrameRef = useRef<number | null>(null);

  const cancelSettleFrame = useCallback(() => {
    if (settleFrameRef.current === null || typeof cancelAnimationFrame !== 'function') return;
    cancelAnimationFrame(settleFrameRef.current);
    settleFrameRef.current = null;
  }, []);

  useLayoutEffect(() => {
    if (!open) return undefined;
    const syncPopupPosition = () => {
      const popup = popupRef.current;
      if (!popup) return;
      const gutter = 8;
      const currentShift = popupShiftRef.current;
      const rect = popup.getBoundingClientRect();
      const boundary = menuRef.current?.closest('.composer-shell')?.getBoundingClientRect();
      const minLeft = Math.max(gutter, boundary ? boundary.left + gutter : gutter);
      const maxRight = Math.min(
        window.innerWidth - gutter,
        boundary ? boundary.right - gutter : window.innerWidth - gutter,
      );
      const baseLeft = rect.left - currentShift;
      const baseRight = rect.right - currentShift;
      let nextShift = 0;
      if (baseRight > maxRight) nextShift -= baseRight - maxRight;
      if (baseLeft + nextShift < minLeft) nextShift += minLeft - (baseLeft + nextShift);
      popupShiftRef.current = Math.round(nextShift);
      setPopupShift(popupShiftRef.current);
    };
    syncPopupPosition();
    window.addEventListener('resize', syncPopupPosition);
    return () => window.removeEventListener('resize', syncPopupPosition);
  }, [menuRef, open, popupRef]);

  useLayoutEffect(() => {
    cancelSettleFrame();
    if (!open) {
      setPositionTransitionsReady(false);
      return undefined;
    }

    setPositionTransitionsReady(false);

    const schedulePositionTransitions = () => {
      cancelSettleFrame();
      if (typeof requestAnimationFrame !== 'function') {
        setPositionTransitionsReady(true);
        return;
      }
      settleFrameRef.current = requestAnimationFrame(() => {
        settleFrameRef.current = requestAnimationFrame(() => {
          settleFrameRef.current = null;
          setPositionTransitionsReady(true);
        });
      });
    };

    const track = trackRef.current;
    if (!track) return undefined;
    let hasValidTrackWidth = false;
    const syncTrackWidth = () => {
      const width = track.getBoundingClientRect().width;
      if (width <= 0) {
        hasValidTrackWidth = false;
        cancelSettleFrame();
        setPositionTransitionsReady(false);
        return;
      }
      hasValidTrackWidth = true;
      const changed = Math.abs(trackWidthRef.current - width) >= 0.5;
      if (!changed) return;
      trackWidthRef.current = width;
      setTrackWidthPx(width);
      setPositionTransitionsReady(false);
      schedulePositionTransitions();
    };
    syncTrackWidth();
    if (hasValidTrackWidth) schedulePositionTransitions();
    const observer = new ResizeObserver(syncTrackWidth);
    observer.observe(track);
    return () => {
      observer.disconnect();
      cancelSettleFrame();
    };
  }, [cancelSettleFrame, open, trackObserveKey, trackRef]);

  return { popupShift, trackWidthPx, positionTransitionsReady };
}

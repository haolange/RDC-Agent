import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

export function useEffortPopupLayout(options: {
  open: boolean;
  menuRef: RefObject<HTMLDivElement | null>;
  popupRef: RefObject<HTMLDivElement | null>;
  trackRef: RefObject<HTMLDivElement | null>;
  trackObserveKey: string;
}): {
  popupShift: number;
  trackWidthPx: number;
} {
  const { open, menuRef, popupRef, trackRef, trackObserveKey } = options;
  const [popupShift, setPopupShift] = useState(0);
  const [trackWidthPx, setTrackWidthPx] = useState(0);
  const popupShiftRef = useRef(0);

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
    if (!open) return undefined;
    const track = trackRef.current;
    if (!track) return undefined;
    const syncTrackWidth = () => {
      const width = track.getBoundingClientRect().width;
      if (width <= 0) return;
      setTrackWidthPx((prev) => (Math.abs(prev - width) < 0.5 ? prev : width));
    };
    syncTrackWidth();
    const observer = new ResizeObserver(syncTrackWidth);
    observer.observe(track);
    return () => observer.disconnect();
  }, [open, trackObserveKey, trackRef]);

  return { popupShift, trackWidthPx };
}

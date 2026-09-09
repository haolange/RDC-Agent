import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import {
  ANCHOR_GAP,
  clamp,
  DROPDOWN_MIN_WIDTH,
  type DropdownPlacement,
  VIEWPORT_MARGIN,
} from './DeviceSelectorParts';

export interface DeviceDropdownPosition {
  left: number;
  top: number;
  width: number;
  ready: boolean;
  placement: DropdownPlacement;
}

export function useDeviceDropdownPosition(options: {
  isOpen: boolean;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  menuRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { isOpen, triggerRef, menuRef } = options;
  const [dropdownPosition, setDropdownPosition] = useState<DeviceDropdownPosition>({
    left: VIEWPORT_MARGIN,
    top: VIEWPORT_MARGIN,
    width: DROPDOWN_MIN_WIDTH,
    ready: false,
    placement: 'below',
  });

  const updateDropdownPosition = useCallback(() => {
    const triggerRect = triggerRef.current?.getBoundingClientRect();
    const dropdownElement = menuRef.current;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    if (!triggerRect) {
      setDropdownPosition({
        left: VIEWPORT_MARGIN,
        top: VIEWPORT_MARGIN,
        width: DROPDOWN_MIN_WIDTH,
        ready: true,
        placement: 'below',
      });
      return;
    }

    const measuredWidth = Math.max(dropdownElement?.offsetWidth ?? 0, DROPDOWN_MIN_WIDTH);
    const width = Math.min(measuredWidth, viewportWidth - VIEWPORT_MARGIN * 2);
    const measuredHeight = dropdownElement?.offsetHeight ?? 320;
    const maxLeft = viewportWidth - width - VIEWPORT_MARGIN;
    const leftCandidate = triggerRect.right - width;
    const left = clamp(leftCandidate, VIEWPORT_MARGIN, maxLeft);
    const preferredTop = triggerRect.top - measuredHeight - ANCHOR_GAP;
    const placement: DropdownPlacement = preferredTop >= VIEWPORT_MARGIN ? 'above' : 'below';
    const topCandidate = placement === 'above'
      ? preferredTop
      : triggerRect.bottom + ANCHOR_GAP;
    const maxTop = viewportHeight - measuredHeight - VIEWPORT_MARGIN;
    const top = clamp(topCandidate, VIEWPORT_MARGIN, maxTop);

    setDropdownPosition({
      left,
      top,
      width,
      ready: true,
      placement,
    });
  }, [menuRef, triggerRef]);

  useEffect(() => {
    if (!isOpen) {
      setDropdownPosition((current) => ({ ...current, ready: false }));
    }
  }, [isOpen]);

  useLayoutEffect(() => {
    if (!isOpen) return;

    updateDropdownPosition();

    const handleViewportChange = () => {
      updateDropdownPosition();
    };

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => updateDropdownPosition())
      : null;

    if (menuRef.current && resizeObserver) {
      resizeObserver.observe(menuRef.current);
    }

    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [isOpen, menuRef, updateDropdownPosition]);

  return dropdownPosition;
}

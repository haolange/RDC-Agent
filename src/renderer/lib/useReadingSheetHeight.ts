import { useCallback, useLayoutEffect, type RefObject } from 'react';
import { assignDynStyle, clearDynStyle } from './useDynStyle';

const verticalInsets = (box: CSSStyleDeclaration): number => (
  Number.parseFloat(box.paddingTop) + Number.parseFloat(box.paddingBottom)
  + Number.parseFloat(box.borderTopWidth) + Number.parseFloat(box.borderBottomWidth)
);

function layoutHeight(element: Element): number {
  // Entrance and exit transforms must not change the intrinsic target.
  const box = getComputedStyle(element);
  return Number.parseFloat(box.height) + (box.boxSizing === 'border-box' ? 0 : verticalInsets(box));
}

/**
 * Measure intrinsic content independently of the animated sheet and its scroller.
 * A new target can arrive mid-transition without resetting the current height.
 */
export function useReadingSheetHeight(
  enabled: boolean,
  sheetRef: RefObject<HTMLDivElement | null>,
  contentRef: RefObject<HTMLDivElement | null>,
  hasStatus: boolean,
): void {
  const measure = useCallback(() => {
    const sheet = sheetRef.current;
    const content = contentRef.current;
    if (!enabled || !sheet || !content) return;
    const body = content.parentElement!;
    const chrome = Array.from(sheet.children).reduce((total, child) => (
      child === body ? total : total + layoutHeight(child)
    ), 0);
    const intrinsicHeight = chrome + verticalInsets(getComputedStyle(body)) + layoutHeight(content);
    const availableHeight = Number.parseFloat(getComputedStyle(sheet).maxHeight);
    assignDynStyle(sheet, { '--reading-sheet-target-height': `${Math.min(intrinsicHeight, availableHeight)}px` });
  }, [enabled, sheetRef, contentRef]);

  // Geometry and content props can change together. Set the target before paint.
  useLayoutEffect(measure);

  useLayoutEffect(() => {
    const sheet = sheetRef.current;
    if (!enabled || !sheet) return;
    return () => clearDynStyle(sheet);
  }, [enabled, sheetRef]);

  useLayoutEffect(() => {
    const sheet = sheetRef.current;
    const content = contentRef.current;
    if (!enabled || !sheet || !content) return;
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    for (const child of sheet.children) {
      if (child !== content.parentElement) observer.observe(child);
    }
    return () => observer.disconnect();
    // The observed chrome changes only when an optional element enters or leaves.
  }, [enabled, sheetRef, contentRef, measure, hasStatus]);
}

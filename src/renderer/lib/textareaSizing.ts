import { assignDynStyle, clearDynStyle } from './useDynStyle';

export function textareaHeight(
  scrollHeight: number,
  lineHeight: number,
  padding: number,
  border: number,
  minRows: number,
  maxRows: number,
  minHeight = 0,
  maxHeight = 0,
) {
  const min = Math.max(1, Math.floor(minRows));
  const max = Math.max(min, Math.floor(maxRows));
  const floor = Math.max(minHeight, lineHeight * min + padding + border);
  const rowCeiling = Math.max(floor, lineHeight * max + padding + border);
  const ceiling = maxHeight > 0 ? Math.max(floor, maxHeight) : rowCeiling;
  const height = Math.max(floor, Math.min(scrollHeight + border, ceiling));
  return { height, overflow: scrollHeight + border > ceiling ? 'auto' : 'hidden' };
}

/** Observe layout as well as edits: hidden panels, font loading and wrapping change height. */
export function observeTextareaSizing(
  element: HTMLTextAreaElement,
  minRows: number,
  maxRows: number,
  bounds?: { minHeight?: number; maxHeight?: number },
) {
  let frame = 0;
  let disposed = false;
  const measure = () => {
    if (disposed || !element.getClientRects().length) return;
    const css = getComputedStyle(element);
    const number = (value: string) => Number.parseFloat(value) || 0;
    const line = number(css.lineHeight) || number(css.fontSize) * 1.5;
    const padding = number(css.paddingTop) + number(css.paddingBottom);
    const border = number(css.borderTopWidth) + number(css.borderBottomWidth);
    assignDynStyle(element, { height: 'auto', 'overflow-y': 'hidden' });
    const result = textareaHeight(
      element.scrollHeight,
      line,
      padding,
      border,
      minRows,
      maxRows,
      Math.max(number(css.minHeight), bounds?.minHeight ?? 0),
      bounds?.maxHeight ?? number(css.maxHeight),
    );
    assignDynStyle(element, { height: `${result.height}px`, 'overflow-y': result.overflow });
  };
  const schedule = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(measure);
  };
  let width = -1;
  const resize = new ResizeObserver((entries) => {
    const next = entries[0]?.contentRect.width ?? 0;
    if (next !== width) { width = next; schedule(); }
  });
  resize.observe(element);
  const mutations = new MutationObserver(schedule);
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    mutations.observe(node, { attributes: true, attributeFilter: ['class', 'style', 'hidden', 'open', 'data-font-scale'] });
  }
  element.addEventListener('input', measure);
  window.addEventListener('resize', schedule);
  document.fonts?.addEventListener('loadingdone', schedule);
  void document.fonts?.ready.then(() => { if (!disposed) schedule(); });
  measure();
  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    resize.disconnect();
    mutations.disconnect();
    element.removeEventListener('input', measure);
    window.removeEventListener('resize', schedule);
    document.fonts?.removeEventListener('loadingdone', schedule);
    clearDynStyle(element);
  };
}

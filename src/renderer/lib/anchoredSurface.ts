export interface SurfaceRect { left: number; right: number; top: number; bottom: number }

/** Fixed-position surface geometry, including viewports smaller than its content. */
export function placeAnchoredSurface(anchor: SurfaceRect, size: { width: number; height: number },
  viewport: { width: number; height: number }, align: 'start' | 'end' = 'start',
  side: 'top' | 'bottom' = 'bottom', margin = 8, gap = 4) {
  const width = Math.max(0, Math.min(size.width, viewport.width - margin * 2));
  const height = Math.max(0, Math.min(size.height, viewport.height - margin * 2));
  const below = viewport.height - margin - anchor.bottom - gap;
  const above = anchor.top - gap - margin;
  const preferred = side === 'bottom' ? below : above;
  const alternate = side === 'bottom' ? above : below;
  const placement = preferred >= height || preferred >= alternate ? side : side === 'bottom' ? 'top' : 'bottom';
  const clamp = (value: number, maximum: number) => Math.max(margin, Math.min(value, Math.max(margin, maximum)));
  return {
    left: clamp(align === 'end' ? anchor.right - width : anchor.left, viewport.width - width - margin),
    top: clamp(placement === 'bottom' ? anchor.bottom + gap : anchor.top - height - gap, viewport.height - height - margin),
    width, height, placement,
  };
}

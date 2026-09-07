import { clampSliderRatio } from './effortControlParts';

/** Matches `.composer-effort-slider-thumb` width (`--space-8`). */
export const EFFORT_THUMB_WIDTH_PX = 32;

export function thumbInsetCenterPx(
  ratio: number,
  trackWidthPx: number,
  thumbWidthPx: number = EFFORT_THUMB_WIDTH_PX,
): number {
  const clamped = clampSliderRatio(ratio);
  if (!Number.isFinite(trackWidthPx) || trackWidthPx <= 0) {
    return 0;
  }
  const half = Math.min(Math.max(thumbWidthPx, 0) / 2, trackWidthPx / 2);
  return half + clamped * (trackWidthPx - 2 * half);
}

/**
 * Maps a logical 0–1 ratio onto a center `left%` so a centered thumb
 * (`translate(-50%)`) stays fully inside the track — no end-edge transform hacks.
 */
export function thumbInsetPercent(
  ratio: number,
  trackWidthPx: number,
  thumbWidthPx: number = EFFORT_THUMB_WIDTH_PX,
): number {
  const clamped = clampSliderRatio(ratio);
  if (!Number.isFinite(trackWidthPx) || trackWidthPx <= 0) {
    return clamped * 100;
  }
  return (thumbInsetCenterPx(clamped, trackWidthPx, thumbWidthPx) / trackWidthPx) * 100;
}

/** Inverse of inset thumb mapping: pointer X → logical 0–1 ratio. */
export function ratioFromInsetClientX(
  clientX: number,
  trackLeftPx: number,
  trackWidthPx: number,
  thumbWidthPx: number = EFFORT_THUMB_WIDTH_PX,
): number {
  if (!Number.isFinite(trackWidthPx) || trackWidthPx <= 0) {
    return 0;
  }
  const half = Math.min(Math.max(thumbWidthPx, 0) / 2, trackWidthPx / 2);
  const usable = trackWidthPx - 2 * half;
  if (usable <= 0) {
    return 0;
  }
  return clampSliderRatio((clientX - trackLeftPx - half) / usable);
}

/** Keeps a centered drag tooltip inside the track box. */
export function clampCenteredTooltipPercent(
  centerPercent: number,
  trackWidthPx: number,
  tooltipWidthPx: number,
): number {
  if (!Number.isFinite(trackWidthPx) || trackWidthPx <= 0) {
    return clampSliderRatio(centerPercent / 100) * 100;
  }
  const half = Math.min(Math.max(tooltipWidthPx, 0) / 2, trackWidthPx / 2);
  const centerPx = clampSliderRatio(centerPercent / 100) * trackWidthPx;
  const clampedPx = Math.max(half, Math.min(trackWidthPx - half, centerPx));
  return (clampedPx / trackWidthPx) * 100;
}

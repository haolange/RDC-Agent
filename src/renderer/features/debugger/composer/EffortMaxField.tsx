import React, { useEffect, useRef } from 'react';
import type { MaxVisualPhase } from './maxVisual';
import {
  clampMaxProgress,
  MAX_VISUAL_EVOLVE_MS,
  MAX_VISUAL_RETREAT_MS,
  maxFieldNoise,
  prefersReducedMotion,
  resolveMaxFieldCell,
  resolveMaxFieldCoverage,
} from './maxVisual';

const CELL = 3;
const GAP = 1;
const STRIDE = CELL + GAP;
const ROWS = 5;

type FieldColors = {
  from: string;
  mid: string;
  to: string;
  sparkle: string;
};

function readCssColor(el: HTMLElement, name: string, fallbackName: string): string {
  const styles = getComputedStyle(el);
  return styles.getPropertyValue(name).trim() || styles.getPropertyValue(fallbackName).trim();
}

function readFieldColors(el: HTMLElement): FieldColors {
  return {
    from: readCssColor(el, '--token-effort-max-from', '--token-effort-fill-5'),
    mid: readCssColor(el, '--token-effort-max-mid', '--token-effort-fill-4'),
    to: readCssColor(el, '--token-effort-max-to', '--token-effort-fill-4'),
    sparkle: readCssColor(el, '--token-effort-max-sparkle', '--token-text-inverse'),
  };
}

function mixCssColor(a: string, b: string, amount: number): string {
  const percent = Math.round(clampMaxProgress(amount) * 100);
  return `color-mix(in srgb, ${b} ${percent}%, ${a})`;
}

function resolveCellColor(colors: FieldColors, tone: number, sparkle: number): string {
  const base = tone < 0.5
    ? mixCssColor(colors.from, colors.mid, tone * 2)
    : mixCssColor(colors.mid, colors.to, (tone - 0.5) * 2);
  if (sparkle > 0.985) return colors.sparkle;
  if (sparkle > 0.94) return mixCssColor(base, colors.sparkle, 0.2);
  return base;
}

function paintPreview(
  ctx: CanvasRenderingContext2D,
  originY: number,
  thumbCol: number,
  colors: FieldColors,
): void {
  for (let col = Math.max(0, thumbCol - 7); col < thumbCol; col += 1) {
    const distance = thumbCol - col;
    const falloff = 1 - (distance - 1) / 7;
    for (let row = 0; row < ROWS; row += 1) {
      const occupancy = maxFieldNoise(col, row, 3);
      const detail = maxFieldNoise(col, row, 5);
      if (occupancy < 0.46 - falloff * 0.18) continue;
      const rowMid = (ROWS - 1) / 2;
      const rowWeight = 0.76 + (1 - Math.abs(row - rowMid) / (rowMid + 0.5)) * 0.24;
      const alpha = (0.24 + falloff * 0.5) * rowWeight * (0.86 + detail * 0.14);
      ctx.globalAlpha = clampMaxProgress(alpha);
      ctx.fillStyle = resolveCellColor(colors, 0.7 + falloff * 0.3, occupancy);
      ctx.fillRect(
        GAP + col * STRIDE,
        originY + row * STRIDE,
        CELL,
        CELL,
      );
    }
  }
  ctx.globalAlpha = 1;
}

function paintField(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  input: {
    phase: MaxVisualPhase;
    progress: number;
    thumbRatio: number;
    timeMs: number;
    colors: FieldColors;
    reduced: boolean;
  },
): void {
  ctx.clearRect(0, 0, width, height);
  if (width < 2 || height < 2) return;

  const cols = Math.max(1, Math.floor((width - GAP) / STRIDE));
  const originY = Math.round((height - (ROWS * STRIDE - GAP)) / 2);
  const thumbCol = Math.max(0, Math.min(cols - 1, Math.round(input.thumbRatio * (cols - 1))));
  if (input.phase === 'preview') {
    paintPreview(ctx, originY, thumbCol, input.colors);
    return;
  }

  const coverage = resolveMaxFieldCoverage(input);
  if (coverage <= 0) return;
  const breath = 0;

  for (let col = 0; col < cols; col += 1) {
    for (let row = 0; row < ROWS; row += 1) {
      const sample = resolveMaxFieldCell({ col, row, cols, rows: ROWS, coverage });
      if (!sample.visible || sample.alpha <= 0.02) continue;
      const shimmerWeight = 0.45 + maxFieldNoise(col, row, 6) * 0.55;
      ctx.globalAlpha = clampMaxProgress(sample.alpha + breath * shimmerWeight);
      ctx.fillStyle = resolveCellColor(
        input.colors,
        sample.tone,
        maxFieldNoise(col, row, 0),
      );
      ctx.fillRect(
        GAP + col * STRIDE,
        originY + row * STRIDE,
        CELL,
        CELL,
      );
    }
  }
  ctx.globalAlpha = 1;
}

export const EffortMaxField: React.FC<{
  phase: MaxVisualPhase;
  progress: number;
  thumbRatio: number;
}> = ({ phase, progress, thumbRatio }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layerRef = useRef<HTMLSpanElement>(null);
  const phaseRef = useRef(phase);
  const progressRef = useRef(progress);
  const thumbRef = useRef(thumbRatio);
  const paintRef = useRef<(timeMs: number, phase?: MaxVisualPhase, progress?: number) => void>(() => undefined);
  const fieldActive = phase !== 'idle';

  phaseRef.current = phase;
  progressRef.current = progress;
  thumbRef.current = thumbRatio;

  useEffect(() => {
    if (!fieldActive) return undefined;
    const canvas = canvasRef.current;
    const layer = layerRef.current;
    const ctx = canvas?.getContext('2d', { alpha: true });
    if (!canvas || !layer || !ctx) return undefined;

    let colors = readFieldColors(layer);
    const reduced = prefersReducedMotion();
    const paint = (timeMs: number, phaseOverride?: MaxVisualPhase, progressOverride?: number) => {
      const width = Math.max(1, Math.floor(layer.clientWidth));
      const height = Math.max(1, Math.floor(layer.clientHeight));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const bitmapWidth = Math.floor(width * dpr);
      const bitmapHeight = Math.floor(height * dpr);
      if (canvas.width !== bitmapWidth || canvas.height !== bitmapHeight) {
        canvas.width = bitmapWidth;
        canvas.height = bitmapHeight;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      paintField(ctx, width, height, {
        phase: phaseOverride ?? phaseRef.current,
        progress: progressOverride ?? progressRef.current,
        thumbRatio: thumbRef.current,
        timeMs,
        colors,
        reduced,
      });
    };
    paintRef.current = paint;

    const resizeObserver = new ResizeObserver(() => paint(performance.now()));
    resizeObserver.observe(layer);
    const themeObserver = new MutationObserver(() => {
      colors = readFieldColors(layer);
      paint(performance.now());
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme', 'data-resolved-theme'],
    });
    paint(performance.now());

    return () => {
      resizeObserver.disconnect();
      themeObserver.disconnect();
      paintRef.current = () => undefined;
    };
  }, [fieldActive]);

  useEffect(() => {
    if (fieldActive) paintRef.current(performance.now());
  }, [fieldActive, phase, progress, thumbRatio]);

  useEffect(() => {
    if (phase !== 'evolve' && phase !== 'retreat') return undefined;
    const duration = phase === 'evolve' ? MAX_VISUAL_EVOLVE_MS : MAX_VISUAL_RETREAT_MS;
    if (prefersReducedMotion() || document.hidden) {
      paintRef.current(performance.now(), phase, 1);
      return undefined;
    }
    let frame = 0;
    const startedAt = performance.now();
    const stop = () => {
      if (!frame) return;
      window.cancelAnimationFrame(frame);
      frame = 0;
    };
    const tick = (now: number) => {
      const next = clampMaxProgress((now - startedAt) / duration);
      paintRef.current(now, phase, next);
      if (next < 1 && !document.hidden) frame = window.requestAnimationFrame(tick);
      else frame = 0;
    };
    const onVisibilityChange = () => {
      if (document.hidden) stop();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    frame = window.requestAnimationFrame(tick);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      stop();
    };
  }, [phase]);

  if (!fieldActive) return null;
  return (
    <span ref={layerRef} className="composer-effort-slider-field" aria-hidden="true">
      <canvas ref={canvasRef} className="composer-effort-slider-field-canvas" />
    </span>
  );
};

import React, { useEffect, useRef } from 'react';
import type { MaxVisualPhase } from './maxVisual';
import {
  MAX_VISUAL_EVOLVE_MS,
  MAX_VISUAL_RETREAT_MS,
  prefersReducedMotion,
  resolveMaxFieldCoverage,
} from './maxVisual';

/**
 * Reference frames (grow Max):
 * 1) dark-gray rail + all stop dots + sparse fragment cluster by thumb
 * 2) lavender pixel cloud grows left with a dithered dissolve edge
 * 3) near-full textured field, right bright / left faint, stops gone
 */
const CELL = 3;
const GAP = 1;
const STRIDE = CELL + GAP;
const ROWS = 5;

function readCssColor(el: HTMLElement, name: string, fallback: string): string {
  const value = getComputedStyle(el).getPropertyValue(name).trim();
  return value || fallback;
}

/** Stable [0,1) — never keyed by wall-clock (avoids stuttering reshuffles). */
function cellNoise(col: number, row: number, salt = 0): number {
  const n = Math.sin((col + 1.7) * 12.9898 + (row + 1.3) * 78.233 + salt * 45.164) * 43758.5453;
  return n - Math.floor(n);
}

function mixCssColor(a: string, b: string, t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  if (clamped <= 0) return a;
  if (clamped >= 1) return b;
  return `color-mix(in srgb, ${b} ${Math.round(clamped * 100)}%, ${a})`;
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
    colorFrom: string;
    colorMid: string;
    colorTo: string;
    colorSpark: string;
    reduced: boolean;
  },
): void {
  ctx.clearRect(0, 0, width, height);
  if (width < 2 || height < 2) return;

  const coverage = resolveMaxFieldCoverage({
    phase: input.phase,
    progress: input.progress,
  });
  const cols = Math.max(1, Math.floor((width - GAP) / STRIDE));
  const gridH = ROWS * STRIDE - GAP;
  const originY = Math.round((height - gridH) / 2);
  const thumbCol = Math.max(0, Math.min(cols - 1, Math.round(input.thumbRatio * (cols - 1))));
  // Soft shimmer only — cell occupancy stays fixed.
  const breath = input.reduced || input.phase !== 'settled'
    ? 0
    : Math.sin(input.timeMs / 1200) * 0.05;

  const colorAlong = (along: number, sparkle: number): string => {
    const base = along < 0.5
      ? mixCssColor(input.colorFrom, input.colorMid, along / 0.5)
      : mixCssColor(input.colorMid, input.colorTo, (along - 0.5) / 0.5);
    if (sparkle > 0.9) return input.colorSpark;
    if (sparkle > 0.78) return mixCssColor(base, input.colorSpark, 0.35);
    return base;
  };

  // Frame 1 language: tight irregular fragments just left of the thumb.
  if (input.phase === 'preview') {
    for (let col = 0; col < cols; col += 1) {
      const dist = thumbCol - col;
      if (dist < 0 || dist > 6) continue;
      const falloff = 1 - dist / 6;
      for (let row = 0; row < ROWS; row += 1) {
        const n1 = cellNoise(col, row, 3);
        const n2 = cellNoise(col, row, 5);
        if (n1 < 0.45 - falloff * 0.15) continue;
        if (n2 < 0.22) continue;
        const mid = (ROWS - 1) / 2;
        const rowSpread = 1 - Math.abs(row - mid) / (mid + 0.5);
        const alpha = falloff * falloff * (0.22 + rowSpread * 0.38) * (0.4 + n1 * 0.55);
        const xJitter = (n2 - 0.5) * 1.4;
        const size = n1 > 0.75 ? CELL : Math.max(2, CELL - 1);
        ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
        ctx.fillStyle = colorAlong(1 - dist / 6, n1);
        ctx.fillRect(
          Math.round(GAP + col * STRIDE + xJitter),
          originY + row * STRIDE,
          size,
          size,
        );
      }
    }
    ctx.globalAlpha = 1;
    return;
  }

  if (coverage <= 0.001 && input.phase !== 'settled') {
    ctx.globalAlpha = 1;
    return;
  }

  /**
   * Frames 2→3: stochastic fill grows from the thumb leftward.
   * Birth thresholds + soft age create a dithered dissolve front (not a hard column wipe).
   */
  for (let col = 0; col < cols; col += 1) {
    const fromRight = cols - 1 - col;
    const t = cols <= 1 ? 0 : fromRight / (cols - 1);
    const along = 1 - t;

    for (let row = 0; row < ROWS; row += 1) {
      const n1 = cellNoise(col, row, 0);
      const n2 = cellNoise(col, row, 1);
      const n3 = cellNoise(col, row, 2);
      const n4 = cellNoise(col, row, 4);

      // Wide noisy birth band → irregular leading edge while growing / retreating.
      const birth = t * 0.62 + n1 * 0.42;
      if (birth > coverage) continue;

      // Neighborhood voids keep the cloud from reading as a uniform lattice.
      if (n4 < 0.12 + t * 0.28) continue;

      // Right denser; left stays porous so the dark-gray rail remains readable.
      const keepChance = (input.phase === 'settled' ? 0.28 : 0.2) + along * 0.52 + n2 * 0.14;
      if (n3 > keepChance) continue;

      const mid = (ROWS - 1) / 2;
      const rowWeight = 0.55 + (1 - Math.abs(row - mid) / (mid + 0.5)) * 0.45;
      // Soft dissolve at the growth front (just-born cells are faint / sparse).
      const age = Math.min(1, (coverage - birth) / 0.22);
      const edgeSoft = age * age;
      let alpha = edgeSoft * (0.18 + along * 0.62) * rowWeight * (0.32 + n1 * 0.68);
      if (input.phase === 'settled') {
        alpha = Math.min(0.82, alpha + breath * (0.5 + n2 * 0.5));
      }

      const xJitter = (row % 2 === 0 ? 0 : 1) + (n2 - 0.5) * 1.6;
      const size = n3 > 0.82 ? CELL + 1 : n3 < 0.25 ? Math.max(2, CELL - 1) : CELL;
      const x = Math.round(GAP + col * STRIDE + xJitter);
      const y = originY + row * STRIDE;
      if (alpha <= 0.02) continue;
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      ctx.fillStyle = colorAlong(along * (0.65 + n2 * 0.35), n1);
      ctx.fillRect(x, y, size, size);
    }
  }
  ctx.globalAlpha = 1;
}

function phaseNeedsLoop(phase: MaxVisualPhase): boolean {
  return phase === 'preview'
    || phase === 'evolve'
    || phase === 'settled'
    || phase === 'retreat';
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
  const phaseClockRef = useRef<{ phase: MaxVisualPhase; startedAt: number }>({
    phase: 'idle',
    startedAt: 0,
  });
  const colorsRef = useRef<{
    from: string;
    mid: string;
    to: string;
    spark: string;
  } | null>(null);

  phaseRef.current = phase;
  progressRef.current = progress;
  thumbRef.current = thumbRatio;

  const fieldActive = phase !== 'idle';

  useEffect(() => {
    if (!fieldActive) return undefined;

    const canvas = canvasRef.current;
    const layer = layerRef.current;
    if (!canvas || !layer) return undefined;

    const reduced = prefersReducedMotion();
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return undefined;

    colorsRef.current = {
      from: readCssColor(layer, '--token-effort-max-from', '#6e6280'),
      mid: readCssColor(layer, '--token-effort-max-mid', '#9b8bb8'),
      to: readCssColor(layer, '--token-effort-max-to', '#c9bddc'),
      spark: readCssColor(layer, '--token-effort-max-sparkle', 'rgba(236,230,245,0.9)'),
    };

    let frame = 0;
    let running = true;

    const syncSize = () => {
      const w = Math.max(1, Math.floor(layer.clientWidth));
      const h = Math.max(1, Math.floor(layer.clientHeight));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const bw = Math.floor(w * dpr);
      const bh = Math.floor(h * dpr);
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      return { w, h };
    };

    const resolvePaintProgress = (now: number, currentPhase: MaxVisualPhase, propProgress: number) => {
      if (phaseClockRef.current.phase !== currentPhase) {
        phaseClockRef.current = { phase: currentPhase, startedAt: now };
      }
      if (currentPhase === 'evolve') {
        const local = Math.min(1, (now - phaseClockRef.current.startedAt) / MAX_VISUAL_EVOLVE_MS);
        return Math.max(propProgress, local);
      }
      if (currentPhase === 'retreat') {
        const local = Math.min(1, (now - phaseClockRef.current.startedAt) / MAX_VISUAL_RETREAT_MS);
        return Math.max(propProgress, local);
      }
      return propProgress;
    };

    const draw = (timeMs: number) => {
      const colors = colorsRef.current!;
      const { w, h } = syncSize();
      const currentPhase = phaseRef.current;
      paintField(ctx, w, h, {
        phase: currentPhase,
        progress: resolvePaintProgress(timeMs, currentPhase, progressRef.current),
        thumbRatio: thumbRef.current,
        timeMs,
        colorFrom: colors.from,
        colorMid: colors.mid,
        colorTo: colors.to,
        colorSpark: colors.spark,
        reduced,
      });
    };

    if (reduced) {
      draw(0);
      return undefined;
    }

    const tick = (now: number) => {
      if (!running) return;
      draw(now);
      if (phaseNeedsLoop(phaseRef.current)) {
        frame = window.requestAnimationFrame(tick);
      }
    };

    frame = window.requestAnimationFrame(tick);
    return () => {
      running = false;
      window.cancelAnimationFrame(frame);
    };
  }, [fieldActive]);

  if (phase === 'idle') {
    return null;
  }

  return (
    <span ref={layerRef} className="composer-effort-slider-field" aria-hidden="true">
      <canvas ref={canvasRef} className="composer-effort-slider-field-canvas" />
    </span>
  );
};

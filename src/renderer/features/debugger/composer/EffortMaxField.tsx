import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { assignDynStyle } from '../../../lib/useDynStyle';
import {
  clampMaxProgress,
  maxFieldNoise,
  type MaxFieldMode,
  type MaxVisualFrame,
  type MaxVisualTimeline,
  prefersReducedMotion,
  resolveMaxClipX,
  resolveMaxFieldCell,
  resolveMaxVisualFrame,
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
    from: readCssColor(el, '--composer-effort-max-from', '--token-effort-max-from')
      || readCssColor(el, '--token-effort-fill-5', '--composer-effort-fill-5'),
    mid: readCssColor(el, '--composer-effort-max-mid', '--token-effort-max-mid')
      || readCssColor(el, '--token-effort-fill-4', '--composer-effort-fill-4'),
    to: readCssColor(el, '--composer-effort-max-to', '--token-effort-max-to')
      || readCssColor(el, '--token-effort-fill-4', '--composer-effort-fill-4'),
    sparkle: readCssColor(el, '--composer-effort-max-sparkle', '--token-effort-max-sparkle')
      || readCssColor(el, '--token-text-inverse', '--composer-effort-max-sparkle'),
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

function paintField(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  frame: MaxVisualFrame,
  colors: FieldColors,
  fieldTimeMs: number,
  emitterRatio: number,
  formationEnergy: number,
  fieldMode: MaxFieldMode,
): void {
  ctx.clearRect(0, 0, width, height);
  const clipX = resolveMaxClipX(width, emitterRatio);
  if (width < 2 || height < 2 || frame.energy <= 0 || clipX <= 0) return;

  const cols = Math.max(1, Math.floor((width - GAP) / STRIDE));
  const originY = Math.round((height - (ROWS * STRIDE - GAP)) / 2);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, clipX, height);
  ctx.clip();
  for (let col = 0; col < cols; col += 1) {
    for (let row = 0; row < ROWS; row += 1) {
      const sample = resolveMaxFieldCell({
        col,
        row,
        cols,
        rows: ROWS,
        energy: frame.energy,
        formationEnergy,
        fieldMode,
        fieldTimeMs,
        emitterRatio,
      });
      if (!sample.visible || sample.alpha <= 0.018) continue;
      ctx.globalAlpha = sample.alpha;
      ctx.fillStyle = resolveCellColor(colors, sample.tone, maxFieldNoise(col, row, 0));
      ctx.fillRect(
        GAP + col * STRIDE,
        originY + row * STRIDE,
        CELL,
        CELL,
      );
    }
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

function syncVisualHost(
  host: HTMLElement,
  frame: MaxVisualFrame,
  emitterRatio: number,
): void {
  const stopsOpacity = clampMaxProgress(frame.stopsOpacity);
  const clipRatio = clampMaxProgress(emitterRatio);
  assignDynStyle(host, { '--composer-effort-stops-opacity': stopsOpacity.toFixed(3) });
  host.dataset.maxPhase = frame.phase;
  host.dataset.maxProgress = frame.progress.toFixed(3);
  host.dataset.maxStopsOpacity = stopsOpacity.toFixed(3);
  host.dataset.maxEmitterRatio = clipRatio.toFixed(3);
  host.dataset.maxFieldEnergy = clampMaxProgress(frame.energy).toFixed(3);
  host.dataset.maxClipRatio = clipRatio.toFixed(3);
}

export const EffortMaxField: React.FC<{
  timeline: MaxVisualTimeline;
  thumbRatio: number;
  onTimelineComplete: (revision: number) => void;
}> = ({ timeline, thumbRatio, onTimelineComplete }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layerRef = useRef<HTMLSpanElement>(null);
  const timelineRef = useRef(timeline);
  const thumbRef = useRef(thumbRatio);
  const completeRef = useRef(onTimelineComplete);
  const paintRef = useRef<(timeMs: number) => MaxVisualFrame | null>(() => null);
  const [motionRevision, setMotionRevision] = useState(0);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onMotionPreferenceChange = () => setMotionRevision((revision) => revision + 1);
    media.addEventListener('change', onMotionPreferenceChange);
    return () => media.removeEventListener('change', onMotionPreferenceChange);
  }, []);

  const fieldActive = timeline.phase !== 'idle';
  timelineRef.current = timeline;
  thumbRef.current = thumbRatio;
  completeRef.current = onTimelineComplete;

  useEffect(() => {
    if (!fieldActive) return undefined;
    const canvas = canvasRef.current;
    const layer = layerRef.current;
    const host = layer?.closest<HTMLElement>('.composer-effort-slider');
    const ctx = canvas?.getContext('2d', { alpha: true });
    if (!canvas || !layer || !host || !ctx) return undefined;

    let colors = readFieldColors(layer);
    const paint = (timeMs: number) => {
      const activeTimeline = timelineRef.current;
      const reduced = prefersReducedMotion();
      const frame = resolveMaxVisualFrame(activeTimeline, timeMs, reduced);
      const width = Math.max(1, Math.floor(layer.clientWidth));
      const height = Math.max(1, Math.floor(layer.clientHeight));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const bitmapWidth = Math.floor(width * dpr);
      const bitmapHeight = Math.floor(height * dpr);
      if (canvas.width !== bitmapWidth || canvas.height !== bitmapHeight) {
        canvas.width = bitmapWidth;
        canvas.height = bitmapHeight;
        assignDynStyle(canvas, { width: `${width}px`, height: `${height}px` });
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      const emitterRatio = clampMaxProgress(thumbRef.current);
      const fieldTimeMs = reduced ? 0 : Math.max(0, timeMs - activeTimeline.fieldEpoch);
      paintField(
        ctx,
        width,
        height,
        frame,
        colors,
        fieldTimeMs,
        emitterRatio,
        activeTimeline.formationEnergy,
        activeTimeline.fieldMode,
      );
      syncVisualHost(host, frame, emitterRatio);
      return frame;
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
      assignDynStyle(host, { '--composer-effort-stops-opacity': '1' });
      paintRef.current = () => null;
    };
  }, [fieldActive]);

  useLayoutEffect(() => {
    if (fieldActive) paintRef.current(performance.now());
  }, [fieldActive, thumbRatio]);

  useEffect(() => {
    if (!fieldActive) return undefined;
    let frameRequest = 0;
    let completionSent = false;
    const tick = (now: number) => {
      const frame = paintRef.current(now);
      if (!frame) return;
      if (frame.complete && !completionSent) {
        completionSent = true;
        completeRef.current(timeline.revision);
        return;
      }
      if (frame.running) frameRequest = window.requestAnimationFrame(tick);
    };
    frameRequest = window.requestAnimationFrame(tick);
    return () => {
      if (frameRequest) window.cancelAnimationFrame(frameRequest);
    };
  }, [fieldActive, motionRevision, timeline.revision]);

  if (!fieldActive) return null;
  return (
    <span ref={layerRef} className="composer-effort-slider-field" aria-hidden="true">
      <canvas ref={canvasRef} className="composer-effort-slider-field-canvas" />
    </span>
  );
};

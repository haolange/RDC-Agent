import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { hexToHsv, hsvToHex, type Hsv } from '@shared/theme/color';
import { useDynStyle } from '../lib/useDynStyle';
import './ColorPickerSurface.css';

const STEP = 1;
const COARSE_STEP = 10;

export interface ColorPickerSurfaceProps {
  value: string;
  onChange: (hex: string) => void;
  testId: string;
  areaLabel: string;
  hueLabel: string;
}

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

/**
 * Self-drawn saturation x value plane plus hue rail. Pointer and keyboard both
 * drive the same HSV state, so the plane, the rail and the hex field stay in sync.
 */
export function ColorPickerSurface({
  value,
  onChange,
  testId,
  areaLabel,
  hueLabel,
}: ColorPickerSurfaceProps) {
  const areaRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<'area' | 'hue' | null>(null);
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value));

  // Keep the hue rail stable while dragging through pure black/white, where
  // hue is mathematically undefined and would otherwise snap to 0.
  useEffect(() => {
    const next = hexToHsv(value);
    setHsv((current) => (
      hsvToHex(current).toLowerCase() === value.toLowerCase()
        ? current
        : { ...next, h: next.s === 0 || next.v === 0 ? current.h : next.h }
    ));
  }, [value]);

  const commit = (next: Hsv) => {
    setHsv(next);
    onChange(hsvToHex(next));
  };

  const applyAreaPoint = (clientX: number, clientY: number) => {
    const rect = areaRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    commit({
      h: hsv.h,
      s: clamp(((clientX - rect.left) / rect.width) * 100, 0, 100),
      v: clamp((1 - (clientY - rect.top) / rect.height) * 100, 0, 100),
    });
  };

  const applyHuePoint = (clientX: number) => {
    const rect = hueRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    commit({ ...hsv, h: clamp(((clientX - rect.left) / rect.width) * 360, 0, 359.99) });
  };

  const startDrag = (kind: 'area' | 'hue') => (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    draggingRef.current = kind;
    event.currentTarget.focus();
    if (kind === 'area') applyAreaPoint(event.clientX, event.clientY);
    else applyHuePoint(event.clientX);
  };

  const moveDrag = (kind: 'area' | 'hue') => (event: PointerEvent<HTMLDivElement>) => {
    if (draggingRef.current !== kind) return;
    if (kind === 'area') applyAreaPoint(event.clientX, event.clientY);
    else applyHuePoint(event.clientX);
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    draggingRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onAreaKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? COARSE_STEP : STEP;
    const deltas: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    const delta = deltas[event.key];
    if (!delta) return;
    event.preventDefault();
    commit({
      h: hsv.h,
      s: clamp(hsv.s + delta[0], 0, 100),
      v: clamp(hsv.v + delta[1], 0, 100),
    });
  };

  const onHueKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? COARSE_STEP : STEP;
    const delta = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
    if (delta === 0) return;
    event.preventDefault();
    commit({ ...hsv, h: clamp(hsv.h + delta, 0, 359.99) });
  };

  const areaStyle = useDynStyle({
    '--color-picker-hue': hsvToHex({ h: hsv.h, s: 100, v: 100 }),
    '--color-picker-x': `${hsv.s}%`,
    '--color-picker-y': `${100 - hsv.v}%`,
  });
  const hueStyle = useDynStyle({ '--color-picker-hue-x': `${(hsv.h / 360) * 100}%` });

  return (
    <div className="color-picker-surface">
      <div
        ref={areaRef}
        className="color-picker-area"
        role="slider"
        tabIndex={0}
        aria-label={areaLabel}
        aria-valuetext={hsvToHex(hsv)}
        data-testid={`${testId}-area`}
        {...areaStyle}
        onPointerDown={startDrag('area')}
        onPointerMove={moveDrag('area')}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onAreaKeyDown}
      >
        <span className="color-picker-thumb" aria-hidden="true" />
      </div>
      <div
        ref={hueRef}
        className="color-picker-hue"
        role="slider"
        tabIndex={0}
        aria-label={hueLabel}
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsv.h)}
        data-testid={`${testId}-hue`}
        {...hueStyle}
        onPointerDown={startDrag('hue')}
        onPointerMove={moveDrag('hue')}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onHueKeyDown}
      >
        <span className="color-picker-hue-thumb" aria-hidden="true" />
      </div>
    </div>
  );
}

import type React from 'react';
import type { ReasoningSelection } from '@shared/types/modelCapability';
import {
  clampSliderRatio,
  findAdjacentSupportedLevel,
  resolveNearestSnapLevel,
} from './effortControlParts';

export function createEffortSliderHandlers(input: {
  trackRef: React.RefObject<HTMLDivElement | null>;
  dragActiveRef: React.MutableRefObject<boolean>;
  suppressClickRef: React.MutableRefObject<boolean>;
  pointerFrameRef: React.MutableRefObject<number>;
  pendingDragRatioRef: React.MutableRefObject<number | null>;
  hasAdjustableReasoning: boolean;
  displayLevel: ReasoningSelection;
  displayLevels: ReasoningSelection[];
  setSnapLevel: React.Dispatch<React.SetStateAction<ReasoningSelection | null>>;
  setDragRatio: React.Dispatch<React.SetStateAction<number | null>>;
  commitEffort: (level: ReasoningSelection) => void;
}) {
  const cancelPendingPointerPaint = () => {
    if (input.pointerFrameRef.current) {
      window.cancelAnimationFrame(input.pointerFrameRef.current);
      input.pointerFrameRef.current = 0;
    }
    input.pendingDragRatioRef.current = null;
  };
  const queueDragRatio = (ratio: number) => {
    input.pendingDragRatioRef.current = ratio;
    if (input.pointerFrameRef.current) return;
    input.pointerFrameRef.current = window.requestAnimationFrame(() => {
      input.pointerFrameRef.current = 0;
      const next = input.pendingDragRatioRef.current;
      input.pendingDragRatioRef.current = null;
      if (next !== null) input.setDragRatio(next);
    });
  };
  const ratioFromClientX = (clientX: number): number => {
    const track = input.trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    return clampSliderRatio((clientX - rect.left) / rect.width);
  };
  const levelFromClientX = (clientX: number): ReasoningSelection => {
    const track = input.trackRef.current;
    if (!track) return input.displayLevels[0] ?? 'off';
    const rect = track.getBoundingClientRect();
    return resolveNearestSnapLevel((clientX - rect.left) / rect.width, input.displayLevels);
  };

  return {
    handleTrackPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
      if (!input.hasAdjustableReasoning) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      input.dragActiveRef.current = true;
      input.setSnapLevel(null);
      cancelPendingPointerPaint();
      input.setDragRatio(ratioFromClientX(event.clientX));
    },
    handleTrackPointerMove: (event: React.PointerEvent<HTMLDivElement>) => {
      if (!input.dragActiveRef.current || !input.hasAdjustableReasoning) return;
      queueDragRatio(ratioFromClientX(event.clientX));
    },
    handleTrackPointerUp: (event: React.PointerEvent<HTMLDivElement>) => {
      if (!input.dragActiveRef.current) return;
      cancelPendingPointerPaint();
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      input.commitEffort(levelFromClientX(event.clientX));
      input.dragActiveRef.current = false;
      input.setDragRatio(null);
      input.suppressClickRef.current = true;
    },
    handleTrackClick: (event: React.MouseEvent<HTMLDivElement>) => {
      if (!input.hasAdjustableReasoning) return;
      if (input.suppressClickRef.current) {
        input.suppressClickRef.current = false;
        return;
      }
      input.commitEffort(levelFromClientX(event.clientX));
    },
    handleThumbKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!input.hasAdjustableReasoning) return;
      const direction = event.key === 'ArrowLeft' || event.key === 'ArrowDown'
        ? -1
        : event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : 0;
      if (direction === 0) return;
      event.preventDefault();
      const next = findAdjacentSupportedLevel(input.displayLevel, direction, input.displayLevels);
      if (next) input.commitEffort(next);
    },
  };
}

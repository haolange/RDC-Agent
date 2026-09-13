import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  bindResizePointerDown,
  isDockedResizeHandleVisible,
  ResizeHandle,
} from './ResizeHandle';

describe('isDockedResizeHandleVisible', () => {
  it('shows the handle only when the rail is docked and expanded', () => {
    expect(isDockedResizeHandleVisible(true, false)).toBe(true);
    expect(isDockedResizeHandleVisible(true, true)).toBe(false);
    expect(isDockedResizeHandleVisible(false, false)).toBe(false);
    expect(isDockedResizeHandleVisible(false, true)).toBe(false);
  });
});

describe('ResizeHandle', () => {
  it('exposes a pointer-only test id without a sibling-width API', () => {
    const markup = renderToStaticMarkup(
      React.createElement(ResizeHandle, { side: 'left', onDragStart() {} }),
    );
    expect(markup).toContain('data-testid="panel-resize-handle-left"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('panel-resize-handle-left');
    expect(markup).toContain('panel-resize-handle-hit');
    expect(markup).not.toContain(' disabled');
  });

  it('marks a disabled handle so overflow hit area can retract', () => {
    const markup = renderToStaticMarkup(
      React.createElement(ResizeHandle, { side: 'right', disabled: true, onDragStart() {} }),
    );
    expect(markup).toContain('data-testid="panel-resize-handle-right"');
    expect(markup).toContain('panel-resize-handle-right disabled');
  });
});

describe('bindResizePointerDown', () => {
  const createEvent = () => {
    const setPointerCapture = vi.fn();
    const preventDefault = vi.fn();
    return {
      event: {
        preventDefault,
        pointerId: 7,
        currentTarget: { setPointerCapture },
      } as unknown as React.PointerEvent<HTMLDivElement>,
      setPointerCapture,
      preventDefault,
    };
  };

  it('captures the pointer and starts the drag', () => {
    const onDragStart = vi.fn();
    const { event, preventDefault, setPointerCapture } = createEvent();
    bindResizePointerDown(false, onDragStart)(event);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(setPointerCapture).toHaveBeenCalledWith(7);
    expect(onDragStart).toHaveBeenCalledWith(event);
  });

  it('ignores pointer down when disabled', () => {
    const onDragStart = vi.fn();
    const { event, preventDefault, setPointerCapture } = createEvent();
    bindResizePointerDown(true, onDragStart)(event);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(setPointerCapture).not.toHaveBeenCalled();
    expect(onDragStart).not.toHaveBeenCalled();
  });

  it('still starts the drag when pointer capture is unsupported', () => {
    const onDragStart = vi.fn();
    const preventDefault = vi.fn();
    const event = {
      preventDefault,
      pointerId: 9,
      currentTarget: {
        setPointerCapture: () => {
          throw new Error('NotAllowedError');
        },
      },
    } as unknown as React.PointerEvent<HTMLDivElement>;
    bindResizePointerDown(false, onDragStart)(event);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(onDragStart).toHaveBeenCalledWith(event);
  });
});

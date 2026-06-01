import { useEffect, useRef, useState } from 'react';
import {
  TERMINAL_DEFAULT_HEIGHT,
  TERMINAL_MAX_HEIGHT,
  TERMINAL_MIN_HEIGHT,
} from '@shared/constants/layout';
import { useLayoutStore } from '../../../stores/layoutStore';
import { clamp } from './terminalFormatters';

export function useTerminalDrawerResize() {
  const terminalHeight = useLayoutStore((state) => state.terminalHeight);
  const setTerminalHeight = useLayoutStore((state) => state.setTerminalHeight);
  const persistLayout = useLayoutStore((state) => state.persistLayout);

  const resizeStateRef = useRef<{ startY: number; startHeight: number; maxHeight: number } | null>(null);
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState) {
        return;
      }

      const nextHeight = clamp(
        resizeState.startHeight - (event.clientY - resizeState.startY),
        TERMINAL_MIN_HEIGHT,
        resizeState.maxHeight,
      );
      setTerminalHeight(nextHeight);
    };

    const handlePointerUp = () => {
      if (!resizeStateRef.current) {
        return;
      }
      resizeStateRef.current = null;
      setIsResizing(false);
      document.body.classList.remove('terminal-resizing');
      void persistLayout();
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      document.body.classList.remove('terminal-resizing');
    };
  }, [persistLayout, setTerminalHeight]);

  const handleResizePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const appMain = (event.currentTarget.closest('.app-main') as HTMLElement | null);
    const maxByViewport = appMain
      ? Math.floor(appMain.getBoundingClientRect().height * 0.65)
      : TERMINAL_MAX_HEIGHT;
    resizeStateRef.current = {
      startY: event.clientY,
      startHeight: terminalHeight,
      maxHeight: clamp(maxByViewport, TERMINAL_MIN_HEIGHT, TERMINAL_MAX_HEIGHT),
    };
    setIsResizing(true);
    document.body.classList.add('terminal-resizing');
  };

  const handleResizeDoubleClick = () => {
    setTerminalHeight(TERMINAL_DEFAULT_HEIGHT);
    void persistLayout();
  };

  return {
    terminalHeight,
    isResizing,
    handleResizePointerDown,
    handleResizeDoubleClick,
  };
}

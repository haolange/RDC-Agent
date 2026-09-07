import { useCallback } from 'react';
import { closeWindow, minimizeWindow, toggleMaximizeWindow } from './appShellBridge';

export function useWindowControls(setWindowMaximized: (maximized: boolean) => void) {
  const handleWindowMinimize = useCallback(async () => {
    await minimizeWindow();
  }, []);

  const handleWindowToggleMaximize = useCallback(async () => {
    const next = await toggleMaximizeWindow();
    if (typeof next === 'boolean') setWindowMaximized(next);
  }, [setWindowMaximized]);

  const handleWindowClose = useCallback(async () => {
    await closeWindow();
  }, []);

  return { handleWindowMinimize, handleWindowToggleMaximize, handleWindowClose };
}

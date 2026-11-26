import { useCallback } from 'react';

export function useClipboardBridge() {
  const copyText = useCallback(async (text: string): Promise<boolean> => {
    try {
      const result = await window.electronAPI.appShell.copyText(text);
      if (result.success) return true;
    } catch (error) {
      // Fall through to the renderer clipboard API.
      console.warn('[clipboard] the app bridge could not copy; trying the renderer clipboard', error);
    }
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }, []);

  const readText = useCallback(async (): Promise<string> => {
    try {
      const result = await window.electronAPI.appShell.readClipboardText();
      if (result.success) return result.text;
    } catch (error) {
      console.warn('[clipboard] the app bridge could not read the clipboard', error);
      return '';
    }
    return '';
  }, []);

  return { copyText, readText };
}

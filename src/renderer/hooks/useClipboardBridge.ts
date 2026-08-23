import { useCallback } from 'react';

export function useClipboardBridge() {
  const copyText = useCallback(async (text: string): Promise<boolean> => {
    try {
      const result = await window.electronAPI?.appShell.copyText(text);
      if (result?.success) return true;
    } catch {
      // Fall through to the renderer clipboard API.
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
      const result = await window.electronAPI?.appShell.readClipboardText();
      if (result?.success) return result.text ?? '';
    } catch {
      return '';
    }
    return '';
  }, []);

  return { copyText, readText };
}

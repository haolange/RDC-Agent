import { useCallback, useEffect, useRef, useState } from 'react';

export type SettingsAutosaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const IDLE_MS = 900;

/**
 * Saves a preference shortly after the user stops typing, or at once on blur. `pending` is whether the draft
 * differs from the saved value; a failure keeps the draft and reports itself next to the field.
 */
export function useSettingsAutosave(draft: unknown, pending: boolean, save: () => Promise<void> | void) {
  const [status, setStatus] = useState<SettingsAutosaveStatus>('idle');
  const latest = useRef(save);
  latest.current = save;
  const timer = useRef<number | undefined>(undefined);
  const run = useCallback(async () => {
    window.clearTimeout(timer.current);
    setStatus('saving');
    try {
      await latest.current();
      setStatus('saved');
    } catch {
      setStatus('error');
    }
  }, []);
  useEffect(() => {
    if (!pending) return undefined;
    timer.current = window.setTimeout(() => void run(), IDLE_MS);
    return () => window.clearTimeout(timer.current);
  }, [draft, pending, run]);
  return { status, flush: () => { if (pending) void run(); } };
}

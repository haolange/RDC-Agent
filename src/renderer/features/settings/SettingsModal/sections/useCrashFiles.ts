import { useCallback, useEffect, useRef, useState } from 'react';
import { clearCrashFiles, readCrashFiles } from '../../../../platform/crashFiles';
import type { CrashFilesSummary } from '@shared/types/lifecycle';

/** The kept minidumps, read when Settings opens; clearing replaces the summary with what is left. */
export function useCrashFiles(onClearFailed: (error: unknown) => void) {
  const [summary, setSummary] = useState<CrashFilesSummary | null>(null);
  const [clearing, setClearing] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    void readCrashFiles()
      .then((value) => {
        if (mounted.current) setSummary(value);
      })
      .catch((error: unknown) => console.warn('[settings] crash files could not be read', error));
    return () => {
      mounted.current = false;
    };
  }, []);
  const clear = useCallback(async () => {
    setClearing(true);
    try {
      const left = await clearCrashFiles();
      if (mounted.current) setSummary(left);
    } catch (error) {
      onClearFailed(error);
    } finally {
      if (mounted.current) setClearing(false);
    }
  }, [onClearFailed]);
  return { summary, clearing, clear };
}

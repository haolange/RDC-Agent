import { useCallback, useEffect, useState } from 'react';
import { getElectronApi } from '../platform/getElectronApi';

export function useGettingStarted(ready: boolean, reportError: (message: string) => void) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!ready) return;
    let current = true;
    getElectronApi()?.appShell.hasSeenGettingStarted().then((seen) => {
      if (current && !seen) setOpen(true);
    }).catch((error: unknown) => { if (current) reportError(String(error)); });
    return () => { current = false; };
  }, [ready, reportError]);
  const close = useCallback(() => {
    setOpen(false);
    void getElectronApi()?.appShell.acknowledgeGettingStarted().catch((error: unknown) => reportError(String(error)));
  }, [reportError]);
  return { open, show: () => setOpen(true), close };
}

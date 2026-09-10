import { useCallback, useEffect, useRef, useState } from 'react';
import { stopBackgroundWork } from './backgroundTaskActions';

export function useSessionWorkStop(sessionId?: string) {
  const generation = useRef(0);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    generation.current += 1;
    setStopping(false);
    setError('');
    return () => { generation.current += 1; };
  }, [sessionId]);
  const stop = useCallback(async () => {
    if (!sessionId || stopping) return;
    const current = generation.current;
    setStopping(true); setError('');
    try { await stopBackgroundWork(sessionId); }
    catch (reason) { if (generation.current === current) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (generation.current === current) setStopping(false); }
  }, [sessionId, stopping]);
  return { stopping, error, stop };
}

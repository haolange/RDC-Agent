import { useCallback, useEffect, useState } from 'react';
import type { RdxRuntimeOverview } from '@shared/types/rdxRuntime';
import { useProjectStore } from '../../../stores/projectStore';

export const useRdxRuntimeOverview = (open: boolean) => {
  const projectRoot = useProjectStore((state) => state.currentProject?.rootPath);
  const [overview, setOverview] = useState<RdxRuntimeOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try { setOverview(await window.electronAPI.rdxRuntime.getOverview(projectRoot)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLoading(false); }
  }, [projectRoot]);
  useEffect(() => { if (open) void refresh(); }, [open, refresh]);
  return { overview, projectRoot, loading, error, refresh, setOverview };
};

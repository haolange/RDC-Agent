import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useProjectStore } from '../../../stores/projectStore';
import { useAsyncValue } from '../../../lib/useAsyncValue';
import { fenceOverviewSetter } from './runtimeOverviewProjection';
import type { RdcRuntimeOverview } from '@shared/types/rdcRuntime';

export const useRdcRuntimeOverview = (open: boolean) => {
  const projectRoot = useProjectStore((state) => state.currentProject?.rootPath);
  const [revision, setRevision] = useState(0);
  const key = JSON.stringify([open, projectRoot ?? null, revision]);
  const read = useAsyncValue(open ? key : null, () => window.electronAPI.rdcRuntime.getOverview(projectRoot));
  // What the sections show: the read for the current key, which their own confirmed changes then update.
  const [overview, setOverview] = useState<RdcRuntimeOverview | null>(null);
  useEffect(() => { setOverview(read.status === 'ready' ? read.value : null); }, [read]);
  const lifetime = useMemo(() => ({ key, active: false }), [key]);
  useLayoutEffect(() => {
    lifetime.active = open;
    return () => { lifetime.active = false; };
  }, [lifetime, open]);
  const setCurrentOverview = useMemo(() => fenceOverviewSetter(lifetime, setOverview), [lifetime]);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  const error = read.status === 'error' ? (read.error instanceof Error ? read.error.message : String(read.error)) : '';
  return {
    overview: read.status === 'ready' ? overview : null,
    projectRoot,
    loading: open && read.status === 'loading',
    error,
    refresh,
    setOverview: setCurrentOverview,
  };
};

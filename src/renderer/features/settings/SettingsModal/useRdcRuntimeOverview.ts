import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import type { RdcRuntimeOverview } from '@shared/types/rdcRuntime';
import { useProjectStore } from '../../../stores/projectStore';
import { observeScopedRequest } from './scopedSkillSelection';
import { fenceOverviewSetter } from './runtimeOverviewProjection';

export const useRdcRuntimeOverview = (open: boolean) => {
  const projectRoot = useProjectStore((state) => state.currentProject?.rootPath);
  const [overview, setOverview] = useState<RdcRuntimeOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [loadedKey, setLoadedKey] = useState('');
  const key = JSON.stringify([open, projectRoot ?? null, revision]);
  const lifetime = useMemo(() => ({ key, active: false }), [key]);
  useLayoutEffect(() => {
    lifetime.active = open;
    return () => { lifetime.active = false; };
  }, [lifetime, open]);
  const setCurrentOverview = useMemo(() => fenceOverviewSetter(lifetime, setOverview), [lifetime]);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    if (!open) return;
    setOverview(null); setLoading(true); setError(''); setLoadedKey(key);
    return observeScopedRequest(window.electronAPI.rdcRuntime.getOverview(projectRoot), (next) => {
      setOverview(next); setLoading(false);
    }, (reason) => {
      setError(reason instanceof Error ? reason.message : String(reason)); setLoading(false);
    });
  }, [open, projectRoot, key]);
  const current = open && loadedKey === key;
  return { overview: current ? overview : null, projectRoot, loading: open && (!current || loading), error: current ? error : '', refresh, setOverview: setCurrentOverview };
};

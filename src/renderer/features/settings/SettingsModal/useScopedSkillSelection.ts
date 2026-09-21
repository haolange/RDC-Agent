import { useCallback, useEffect, useState } from 'react';
import type { SkillSelectionProjection } from '@shared/types/rdcRuntime';
import { useProjectStore } from '../../../stores/projectStore';
import { observeScopedRequest, resolveSkillSelectionRequest, type SkillSelectionScope } from './scopedSkillSelection';

interface CatalogState {
  key: string;
  revision: number;
  catalog: SkillSelectionProjection | null;
  loading: boolean;
  error: string;
}

/** The overview endpoint owns resolution; this hook only scopes and fences its responses. */
export function useScopedSkillSelection(scope: SkillSelectionScope, open = true) {
  const currentProjectRoot = useProjectStore((state) => state.currentProject?.rootPath);
  const request = resolveSkillSelectionRequest(scope, currentProjectRoot);
  const enabled = open && request.enabled;
  const projectRoot = request.projectRoot;
  // Include the current project even in user scope so switching workspace invalidates in-flight work.
  const key = JSON.stringify([scope, currentProjectRoot ?? null, enabled]);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<CatalogState | null>(null);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    if (!enabled) return;
    setState({ key, revision, catalog: null, loading: true, error: '' });
    return observeScopedRequest(window.electronAPI.rdcRuntime.getOverview(projectRoot), (overview) => {
      const catalog = overview.skillSelection;
      setState({ key, revision, catalog, loading: false, error: catalog.status === 'error' ? catalog.error.message : '' });
    }, (reason: unknown) => {
      setState({ key, revision, catalog: null, loading: false, error: reason instanceof Error ? reason.message : String(reason) });
    });
  }, [enabled, key, projectRoot, revision]);

  const current = enabled && state?.key === key && state.revision === revision ? state : null;
  return {
    catalog: current?.catalog ?? null,
    loading: enabled && (current?.loading ?? true),
    error: current?.error ?? '',
    enabled,
    refresh,
  };
}

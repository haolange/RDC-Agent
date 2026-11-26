import { useCallback, useState } from 'react';
import { useProjectStore } from '../../../stores/projectStore';
import { useAsyncValue } from '../../../lib/useAsyncValue';
import { resolveSkillSelectionRequest, type SkillSelectionScope } from './scopedSkillSelection';

/** The overview endpoint owns resolution; this hook only scopes its reads (a late answer for another scope is dropped). */
export function useScopedSkillSelection(scope: SkillSelectionScope) {
  const currentProjectRoot = useProjectStore((state) => state.currentProject?.rootPath);
  const request = resolveSkillSelectionRequest(scope, currentProjectRoot);
  const enabled = request.enabled;
  const projectRoot = request.projectRoot;
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  // Include the current project even in user scope so switching workspace supersedes the read in flight.
  const read = useAsyncValue(
    enabled ? JSON.stringify([scope, currentProjectRoot ?? null, revision]) : null,
    async () => (await window.electronAPI.rdcRuntime.getOverview(projectRoot)).skillSelection,
  );
  const catalog = read.status === 'ready' ? read.value : null;
  const error =
    read.status === 'error'
      ? read.error instanceof Error
        ? read.error.message
        : String(read.error)
      : catalog?.status === 'error'
        ? catalog.error.message
        : '';
  return { catalog, loading: enabled && read.status === 'loading', error, enabled, refresh };
}

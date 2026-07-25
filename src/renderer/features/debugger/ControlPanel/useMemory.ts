import { useCallback, useEffect, useState } from 'react';
import type { MemoryDetail, MemorySummary, MemoryWriteRequest } from '@shared/types/electron';
import { useProjectStore } from '../../../stores/projectStore';

/**
 * Memory 面板数据 hook（IPC 调用集中在此，满足 R3：tsx 不直接调 window.electronAPI）。
 *
 * 管理 memory 列表、选中详情、CRUD 操作与加载态。
 */
export interface MemoryState {
  memories: MemorySummary[];
  selected: MemoryDetail | null;
  loading: boolean;
  error: string | null;
  scope: 'user' | 'project';
  setScope: (scope: 'user' | 'project') => void;
  refresh: () => Promise<void>;
  select: (name: string | null) => Promise<void>;
  write: (request: Omit<MemoryWriteRequest, 'approvalToken' | 'scope' | 'projectRoot'>) => Promise<{ success: boolean; error?: string }>;
  remove: (name: string) => Promise<{ success: boolean; error?: string }>;
}

export function useMemory(): MemoryState {
  const projectRoot = useProjectStore((state) => state.currentProject?.rootPath);
  const [scope, setScope] = useState<'user' | 'project'>(projectRoot ? 'project' : 'user');
  const [memories, setMemories] = useState<MemorySummary[]>([]);
  const [selected, setSelected] = useState<MemoryDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.electronAPI.memory.list(scope, projectRoot);
      setMemories(result.memories);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [projectRoot, scope]);

  const select = useCallback(async (name: string | null) => {
    if (!name) {
      setSelected(null);
      return;
    }
    try {
      const result = await window.electronAPI.memory.get(scope, name, projectRoot);
      setSelected(result.memory);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSelected(null);
    }
  }, [projectRoot, scope]);

  const write = useCallback(async (request: Omit<MemoryWriteRequest, 'approvalToken' | 'scope' | 'projectRoot'>) => {
    const tokenResult = await window.electronAPI.memory.issueApprovalToken({
      action: 'memory.write',
      scope,
      name: request.name,
      projectRoot,
    });
    if (!tokenResult.token) {
      return { success: false, error: tokenResult.error || 'Failed to issue memory write approvalToken.' };
    }
    const result = await window.electronAPI.memory.write({
      ...request,
      scope,
      projectRoot,
      approvalToken: tokenResult.token,
    });
    if (result.success) {
      await refresh();
    }
    return { success: result.success, error: result.error };
  }, [projectRoot, refresh, scope]);

  const remove = useCallback(async (name: string) => {
    const tokenResult = await window.electronAPI.memory.issueApprovalToken({
      action: 'memory.delete',
      scope,
      name,
      projectRoot,
    });
    if (!tokenResult.token) {
      return { success: false, error: tokenResult.error || 'Failed to issue memory delete approvalToken.' };
    }
    const result = await window.electronAPI.memory.delete(scope, name, tokenResult.token, projectRoot);
    if (result.success) {
      setSelected(null);
      await refresh();
    }
    return { success: result.success, error: result.error };
  }, [projectRoot, refresh, scope]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { memories, selected, loading, error, scope, setScope, refresh, select, write, remove };
}

import { useCallback, useEffect, useState } from 'react';
import type { MemoryDetail, MemorySummary, MemoryWriteRequest } from '@shared/types/electron';

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
  refresh: () => Promise<void>;
  select: (name: string | null) => Promise<void>;
  write: (request: MemoryWriteRequest) => Promise<{ success: boolean; error?: string }>;
  remove: (name: string) => Promise<{ success: boolean; error?: string }>;
}

export function useMemory(): MemoryState {
  const [memories, setMemories] = useState<MemorySummary[]>([]);
  const [selected, setSelected] = useState<MemoryDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.electronAPI.memory.list();
      setMemories(result.memories);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const select = useCallback(async (name: string | null) => {
    if (!name) {
      setSelected(null);
      return;
    }
    try {
      const result = await window.electronAPI.memory.get(name);
      setSelected(result.memory);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSelected(null);
    }
  }, []);

  const write = useCallback(async (request: MemoryWriteRequest) => {
    const result = await window.electronAPI.memory.write(request);
    if (result.success) {
      await refresh();
    }
    return { success: result.success, error: result.error };
  }, [refresh]);

  const remove = useCallback(async (name: string) => {
    const result = await window.electronAPI.memory.delete(name);
    if (result.success) {
      setSelected(null);
      await refresh();
    }
    return { success: result.success, error: result.error };
  }, [refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { memories, selected, loading, error, refresh, select, write, remove };
}

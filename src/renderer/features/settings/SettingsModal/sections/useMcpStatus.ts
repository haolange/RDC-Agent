import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MCPServerStatusSummary } from '@shared/types/mcp';
import { getMcpStatusSummary } from './mcpStatusActions';

export interface McpStatusState {
  servers: MCPServerStatusSummary[];
  byId: Map<string, MCPServerStatusSummary>;
  loading: boolean;
  /** `null` while the summary loads fine; a message when the bridge is missing or throws. */
  error: string | null;
  unavailable: boolean;
  refresh: () => Promise<void>;
}

/** Live MCP connection summary joined into the scoped MCP resource list by server id / name. */
export function useMcpStatus(): McpStatusState {
  const [servers, setServers] = useState<MCPServerStatusSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await getMcpStatusSummary();
      if (!next) {
        setServers([]);
        setUnavailable(true);
        setError(null);
        return;
      }
      setServers(Array.isArray(next) ? next : []);
      setUnavailable(false);
      setError(null);
    } catch (failure) {
      setServers([]);
      setUnavailable(false);
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const byId = useMemo(() => {
    const map = new Map<string, MCPServerStatusSummary>();
    for (const server of servers) {
      map.set(server.id, server);
      if (server.name && !map.has(server.name)) map.set(server.name, server);
    }
    return map;
  }, [servers]);

  return { servers, byId, loading, error, unavailable, refresh };
}

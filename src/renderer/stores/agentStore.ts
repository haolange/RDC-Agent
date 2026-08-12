/**
 * Agent 状态管理 Store。
 *
 * 追踪各 Agent 角色的运行状态，由 IPC 事件 `agent:statusChanged` 驱动更新。
 * 键为 sessionId::agentId，避免跨 session 串台。
 */
import { create } from 'zustand';
import type { AgentState } from '@shared/types/agent';

function agentStateKey(state: AgentState): string {
  return `${state.sessionId}::${state.agentId}`;
}

interface AgentStoreState {
  /** 所有 Agent 的最新状态快照，按 sessionId::agentId 索引。 */
  agents: Record<string, AgentState>;
  /** 更新指定 Agent 的状态。 */
  updateAgentState: (state: AgentState) => void;
  /** 获取指定 scope + Agent 的状态。 */
  getAgentState: (sessionId: string, agentId: string) => AgentState | undefined;
  /** 清空指定 scope 下的执行态。 */
  clearScope: (sessionId: string) => void;
  /** 清空所有状态。 */
  reset: () => void;
}

export const useAgentStore = create<AgentStoreState>((set, get) => ({
  agents: {},
  updateAgentState: (state) => {
    if (state.sessionId.startsWith('ephemeral:') || state.sessionId.includes('::subagent::')) {
      return;
    }
    set((s) => ({
      agents: { ...s.agents, [agentStateKey(state)]: state },
    }));
  },
  getAgentState: (sessionId, agentId) => get().agents[`${sessionId}::${agentId}`],
  clearScope: (sessionId) => {
    const prefix = `${sessionId}::`;
    set((s) => {
      const next = { ...s.agents };
      for (const key of Object.keys(next)) {
        if (key.startsWith(prefix)) delete next[key];
      }
      return { agents: next };
    });
  },
  reset: () => set({ agents: {} }),
}));

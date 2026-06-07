/**
 * Agent 状态管理 Store。
 *
 * 追踪各 Agent 角色的运行状态，由 IPC 事件 `agent:statusChanged` 驱动更新。
 */
import { create } from 'zustand';
import type { AgentState } from '@shared/types/agent';

interface AgentStoreState {
  /** 所有 Agent 的最新状态快照，按 agentId 索引。 */
  agents: Record<string, AgentState>;
  /** 更新指定 Agent 的状态。 */
  updateAgentState: (state: AgentState) => void;
  /** 获取指定 Agent 的状态。 */
  getAgentState: (agentId: string) => AgentState | undefined;
  /** 清空所有状态。 */
  reset: () => void;
}

export const useAgentStore = create<AgentStoreState>((set, get) => ({
  agents: {},
  updateAgentState: (state) =>
    set((s) => ({
      agents: { ...s.agents, [state.agentId]: state },
    })),
  getAgentState: (agentId) => get().agents[agentId],
  reset: () => set({ agents: {} }),
}));

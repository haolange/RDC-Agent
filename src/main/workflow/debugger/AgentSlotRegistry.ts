/**
 * AgentSlotRegistry — agentStates / agentConfigs / agentSlots 的单一登记处。
 *
 * Slot 是执行缓存，不跨 turn 持有 canonical history：
 *  - turn 开始：rehydrate(messagesFromDisk)
 *  - turn 结束：flush() 清空 in-memory messages（磁盘 conversation.jsonl 为权威）
 */

import type {
  AgentCategory,
  AgentConfig,
  AgentId,
  AgentRole,
  AgentState,
  WriteScope,
} from '@shared/types/agent';
import { isTopLevelAgentId } from '@shared/types/agent';
import {
  AGENT_CATEGORIES,
  AGENT_ROLES,
  AGENT_WRITE_SCOPES,
  DEFAULT_MODEL_ROUTING,
} from '@shared/constants/agents';
import type { LLMConfig } from '@shared/types/llm';
import { nowIso } from '@shared/utils/id';
import type { Agent } from '../../agent-runtime/agent/Agent';
import type { ContextManager } from '../../agent-runtime/agent/ContextManager';
import type { AgentMessage } from '../../agent-runtime/core/types';
import { requireExecutionScopeId } from './executionScope';

/** 单个 AgentRole 在内部维护的运行态。 */
export interface AgentSlot {
  agent: Agent;
  contextManager: ContextManager;
  providerId: string;
  modelId: string;
  systemPrompt: string;
  /** 按全部可用工具名计算；激活集是 slot 内状态，不参与 signature。 */
  toolSignature: string;
  turnSignature: string;
  contextTokenLimit: number;
  /** 本 slot 已激活、可注入 prompt 的 deferred 工具名（mcp__* 与 extended builtin）。 */
  activatedDeferredTools: Set<string>;
}

export function agentSlotKey(sessionOrScopeId: string, agentId: AgentRole): string {
  const scope = requireExecutionScopeId(sessionOrScopeId);
  return `${scope}::${agentId}`;
}

export function agentStateKey(sessionOrScopeId: string, agentId: AgentRole): string {
  return agentSlotKey(sessionOrScopeId, agentId);
}

export class AgentSlotRegistry {
  private readonly agentStates = new Map<string, AgentState>();
  private readonly agentConfigs = new Map<AgentRole, AgentConfig>();
  private readonly agentSlots = new Map<string, AgentSlot>();
  private readonly quarantinedSlots = new Map<string, Promise<void>>();

  initializeDefaults(): void {
    for (const role of AGENT_ROLES) {
      this.agentConfigs.set(role, this.createDefaultAgentConfig(role));
    }
  }

  ensureAgentState(sessionOrScopeId: string, agentId: AgentRole): AgentState {
    const key = agentStateKey(sessionOrScopeId, agentId);
    const existing = this.agentStates.get(key);
    if (existing) return existing;
    const state: AgentState = {
      agentId,
      sessionId: requireExecutionScopeId(sessionOrScopeId),
      status: 'idle',
      lastActivity: nowIso(),
    };
    this.agentStates.set(key, state);
    return state;
  }

  getAgentState(sessionOrScopeId: string, agentId: AgentRole): AgentState | null {
    return this.agentStates.get(agentStateKey(sessionOrScopeId, agentId)) ?? null;
  }

  getAllAgentStates(): AgentState[] {
    return Array.from(this.agentStates.values());
  }

  updateAgentStatus(sessionOrScopeId: string, agentId: AgentRole, status: AgentState['status']): AgentState {
    const state = this.ensureAgentState(sessionOrScopeId, agentId);
    state.status = status;
    state.lastActivity = nowIso();
    if (status === 'error') {
      state.error = 'Agent turn failed';
    } else {
      delete state.error;
    }
    return state;
  }

  createDefaultAgentConfig(agentId: AgentRole): AgentConfig {
    const fallbackAgentId: AgentId = isTopLevelAgentId(agentId) ? agentId : 'edit';
    const defaultRouting = DEFAULT_MODEL_ROUTING[fallbackAgentId];
    return {
      agentId,
      systemPrompt: '',
      modelProvider: defaultRouting.provider,
      modelName: defaultRouting.model,
      temperature: 0.7,
      maxTokens: 4096,
      category: this.getAgentCategory(agentId),
      writeScope: this.getAgentWriteScopes(agentId),
    };
  }

  getOrCreateAgentConfig(agentId: AgentRole): AgentConfig {
    const existing = this.agentConfigs.get(agentId);
    if (existing) return existing;
    const config = this.createDefaultAgentConfig(agentId);
    this.agentConfigs.set(agentId, config);
    return config;
  }

  configureAgent(agentId: AgentRole, config: Partial<AgentConfig>): void {
    const existing = this.getOrCreateAgentConfig(agentId);
    this.agentConfigs.set(agentId, { ...existing, ...config });
  }

  getAgentConfig(agentId: AgentRole): AgentConfig | null {
    return this.agentConfigs.get(agentId) ?? null;
  }

  applyLlmConfig(config: LLMConfig): void {
    const routeMap = new Map(config.agentRoutes.map((route) => [route.agentId, route]));
    for (const [agentId, agentConfig] of this.agentConfigs.entries()) {
      const fallbackAgentId: AgentId = isTopLevelAgentId(agentId) ? agentId : 'edit';
      const fallback = DEFAULT_MODEL_ROUTING[fallbackAgentId];
      const route = routeMap.get(agentId);
      this.agentConfigs.set(agentId, {
        ...agentConfig,
        modelProvider: route?.providerId ?? fallback.provider,
        modelName: route?.modelId ?? fallback.model,
      });
    }
  }

  getSlot(slotKey: string): AgentSlot | undefined {
    return this.agentSlots.get(slotKey);
  }

  isQuarantined(slotKey: string): boolean {
    return this.quarantinedSlots.has(slotKey);
  }

  /** Keep an orphaned slot key reserved until its provider/tool loop settles. */
  quarantineSlot(slotKey: string, completion: Promise<unknown>): void {
    if (this.quarantinedSlots.has(slotKey)) return;
    const tracked = Promise.resolve(completion).then(() => undefined, () => undefined);
    this.quarantinedSlots.set(slotKey, tracked);
    void tracked.then(() => {
      if (this.quarantinedSlots.get(slotKey) === tracked) {
        this.quarantinedSlots.delete(slotKey);
      }
    });
  }

  setSlot(slotKey: string, slot: AgentSlot): void {
    this.agentSlots.set(slotKey, slot);
  }

  deleteSlot(slotKey: string): void {
    this.agentSlots.delete(slotKey);
  }

  /**
   * Turn 开始：用磁盘/journal 物化的 messages 覆盖 slot 内存历史。
   * Agent 不跨 turn 持有 canonical history。
   */
  rehydrate(slot: AgentSlot, messages: AgentMessage[]): void {
    slot.agent.rehydrateMessages(messages);
  }

  /**
   * Turn 结束：清空 slot 内存 messages。
   * 持久化由 ConversationService → conversation.jsonl 负责（单一真相）。
   */
  flush(slot: AgentSlot): void {
    slot.agent.clearMessages();
  }

  /** 分支切换 / 重写后显式同步：丢弃该 session 下全部 slot 执行缓存。 */
  syncSession(sessionId: string): void {
    const prefix = `${sessionId}::`;
    for (const key of Array.from(this.agentSlots.keys())) {
      if (key.startsWith(prefix)) {
        const slot = this.agentSlots.get(key);
        if (slot) {
          try {
            slot.agent.abort();
          } catch {
            // ignore
          }
          if (slot.agent.activeLoopPromise) {
            this.quarantineSlot(key, slot.agent.activeLoopPromise);
          }
          slot.agent.clearMessages();
        }
        this.agentSlots.delete(key);
      }
    }
  }

  private getAgentCategory(role: AgentRole): AgentCategory {
    return isTopLevelAgentId(role) ? AGENT_CATEGORIES[role] : 'general';
  }

  private getAgentWriteScopes(role: AgentRole): WriteScope[] {
    return isTopLevelAgentId(role) ? AGENT_WRITE_SCOPES[role] : ['workspace_notes'];
  }
}

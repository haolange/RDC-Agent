/**
 * SubagentSpawner — 子 Agent 实例工厂。
 *
 * 负责创建隔离的子 Agent：共享父 Agent 的 Provider 和认证，
 * 但拥有独立的消息历史、工具子集和事件流。
 * 参考 spawn_teammate 模式，确保子 Agent 具备完整的生命周期管理。
 */

import { randomUUID } from 'node:crypto';
import { Agent } from '../agent/Agent';
import type { Model } from '../core/types';
import type { ProviderStrategy } from '../core/ProviderRegistry';
import type { ToolExecutor } from '../agent/AgentLoop';

/** 子 Agent 配置。 */
export interface SubagentConfig {
  /** 子 Agent 名称（用于标识和日志）。 */
  name: string;
  /** 子 Agent 角色描述。 */
  role: string;
  /** 系统提示词。 */
  systemPrompt: string;
  /** 允许使用的工具名称列表（从父 Agent 工具集过滤）。 */
  allowedTools: string[];
  /** 可选：覆盖使用的模型。 */
  model?: Model;
  /** 最大循环轮数。 */
  maxTurns?: number;
}

/** 子 Agent 运行状态。 */
export type SubagentStatus = 'running' | 'idle' | 'terminated';

/** 子 Agent 句柄，用于外部控制和监听。 */
export interface SubagentHandle {
  /** 子 Agent 唯一 id。 */
  id: string;
  /** 配置中的名称。 */
  name: string;
  /** 配置中的角色。 */
  role: string;
  /** 底层 Agent 实例（可 subscribe 监听事件）。 */
  agent: Agent;
  /** 当前状态。 */
  status: SubagentStatus;
  /** 中止子 Agent 当前流。 */
  abort(): void;
  /** 向子 Agent 发送消息（触发一次 prompt）。 */
  sendMessage(text: string): Promise<void>;
}

/**
 * 子 Agent 实例工厂。
 *
 * 维护所有活跃子 Agent 的生命周期，支持批量关闭。
 */
export class SubagentSpawner {
  private readonly handles = new Map<string, MutableSubagentHandle>();

  /**
   * 创建并启动一个子 Agent。
   *
   * 子 Agent 共享父 Agent 的 provider / getApiKey，
   * 但工具集按 allowedTools 做子集过滤，消息历史独立。
   */
  spawn(
    config: SubagentConfig,
    parentAgent: Agent,
    deps: SubagentDeps,
  ): SubagentHandle {
    const id = randomUUID();

    // 从父 Agent 工具集过滤子 Agent 可用工具
    const parentTools = parentAgent.state.tools ?? [];
    const filteredTools = parentTools.filter((t) =>
      config.allowedTools.includes(t.name),
    );

    const subagent = new Agent({
      initialState: {
        model: config.model ?? parentAgent.state.model,
        systemPrompt: config.systemPrompt,
        tools: filteredTools,
        messages: [],
      },
      provider: deps.provider,
      toolExecutor: deps.toolExecutor,
      getApiKey: deps.getApiKey,
      maxTurns: config.maxTurns ?? 50,
    });

    const handle: MutableSubagentHandle = {
      id,
      name: config.name,
      role: config.role,
      agent: subagent,
      status: 'idle',
      abort: () => {
        subagent.abort();
      },
      sendMessage: async (text: string) => {
        if (handle.status === 'terminated') {
          throw new Error(`Subagent "${config.name}" has been terminated`);
        }
        handle.status = 'running';
        try {
          await subagent.prompt(text);
        } finally {
          // terminate() 可能在 await 期间并发修改 status
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          if ((handle.status as SubagentStatus) !== 'terminated') {
            handle.status = 'idle';
          }
        }
      },
    };

    this.handles.set(id, handle);
    return handle;
  }

  /** 列出所有活跃（非 terminated）的子 Agent。 */
  listActive(): SubagentHandle[] {
    const result: SubagentHandle[] = [];
    for (const handle of this.handles.values()) {
      if (handle.status !== 'terminated') {
        result.push(handle);
      }
    }
    return result;
  }

  /** 停止所有子 Agent 并清理。 */
  async shutdownAll(): Promise<void> {
    for (const handle of this.handles.values()) {
      if (handle.status !== 'terminated') {
        handle.abort();
        handle.status = 'terminated';
      }
    }
    this.handles.clear();
  }

  /** 按 id 终止单个子 Agent。 */
  terminate(id: string): void {
    const handle = this.handles.get(id);
    if (handle && handle.status !== 'terminated') {
      handle.abort();
      handle.status = 'terminated';
    }
  }
}

/** spawn 所需的外部依赖（从父 Agent 提取）。 */
export interface SubagentDeps {
  /** 共享的 Provider 策略。 */
  provider: ProviderStrategy;
  /** 共享或受限的工具执行器。 */
  toolExecutor?: ToolExecutor;
  /** 动态 API key 获取函数。 */
  getApiKey?: (provider: string) => Promise<string | undefined>;
}

/** 内部可变句柄类型（status 可写）。 */
interface MutableSubagentHandle extends Omit<SubagentHandle, 'status'> {
  status: SubagentStatus;
}

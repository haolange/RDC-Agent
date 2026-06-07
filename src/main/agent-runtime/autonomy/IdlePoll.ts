/**
 * 自主认领轮询器（IdlePoll）。
 *
 * 当 Agent 处于空闲状态时，定期扫描任务板，找到满足条件的任务
 * （`status === 'pending'` 且 `owner` 为空，且 `canStart === true`），
 * 自动认领并驱动 Agent 执行；任务执行完毕后将其标记为 `completed`。
 *
 * 设计要点：
 *  - 防重入：每次 `poll()` 入口检查 Agent 是否处于 streaming，以及自身是否
 *    正在执行中（`_isPolling` 锁）；
 *  - 错误隔离：单次轮询/任务执行抛错不会中断后续轮询；
 *  - 优雅停止：`stopPolling()` 仅停止定时器，不会中断已经在执行的任务；
 *  - 运行时开关：`setAutoClaimEnabled(false)` 可暂停自动认领但保留定时器。
 *
 * 参考：learn-claude-code s17 的 idle_poll 机制。
 */

import type { Agent, UserMessage } from '../agent/Agent';
import type { TaskRecord, TaskRegistry } from '../tasks/TaskRegistry';

/** 默认轮询间隔（毫秒）。 */
const DEFAULT_POLL_INTERVAL_MS = 5000;
/** 默认 owner 名称。 */
const DEFAULT_AGENT_NAME = 'agent';
/** 默认单次轮询认领上限。 */
const DEFAULT_MAX_CLAIM_PER_POLL = 1;

/** IdlePoll 构造配置。 */
export interface IdlePollConfig {
  /** 轮询间隔（毫秒），默认 5000。 */
  pollIntervalMs?: number;
  /** TaskRegistry 实例。 */
  taskRegistry: TaskRegistry;
  /** 被控制的 Agent 实例。 */
  agent: Agent;
  /** 是否启用自动认领，默认 `true`。 */
  autoClaimEnabled?: boolean;
  /** Agent 名称（写入任务的 `owner` 字段），默认 `'agent'`。 */
  agentName?: string;
  /** 单次轮询最多认领的任务数，默认 1。 */
  maxClaimPerPoll?: number;
}

/**
 * 空闲轮询器。
 *
 * 一个 IdlePoll 绑定到唯一的 Agent；多 Agent 协作时各自实例化即可。
 */
export class IdlePoll {
  /** TaskRegistry 引用。 */
  private readonly taskRegistry: TaskRegistry;
  /** 受控 Agent 引用。 */
  private readonly agent: Agent;
  /** 轮询间隔（毫秒）。 */
  private readonly pollIntervalMs: number;
  /** Agent 名称（owner 字段）。 */
  private readonly agentName: string;
  /** 单次轮询认领上限。 */
  private readonly maxClaimPerPoll: number;

  /** 自动认领开关。 */
  private autoClaimEnabled: boolean;
  /** 当前定时器句柄；为 `null` 表示未启动。 */
  private intervalHandle: NodeJS.Timeout | null = null;
  /** 单次 poll 重入锁。 */
  private isPollingNow = false;

  /**
   * 创建一个新的 IdlePoll。
   *
   * @param config 见 {@link IdlePollConfig}。
   */
  constructor(config: IdlePollConfig) {
    if (!config || !config.taskRegistry || !config.agent) {
      throw new Error('IdlePoll: taskRegistry 和 agent 为必填项');
    }
    this.taskRegistry = config.taskRegistry;
    this.agent = config.agent;
    this.pollIntervalMs = clampPositive(
      config.pollIntervalMs,
      DEFAULT_POLL_INTERVAL_MS,
    );
    this.agentName =
      typeof config.agentName === 'string' && config.agentName.length > 0
        ? config.agentName
        : DEFAULT_AGENT_NAME;
    this.maxClaimPerPoll = clampPositive(
      config.maxClaimPerPoll,
      DEFAULT_MAX_CLAIM_PER_POLL,
    );
    this.autoClaimEnabled = config.autoClaimEnabled ?? true;
  }

  /**
   * 启动轮询。多次调用为幂等：已经在轮询时不会创建第二个定时器。
   */
  startPolling(): void {
    if (this.intervalHandle !== null) {
      return;
    }
    this.intervalHandle = setInterval(() => {
      // setInterval 不接受 async 回调，使用 fire-and-forget + 错误隔离。
      void this.poll().catch((err) => {
        // 顶层兜底：任何来自 poll() 的异常都不应中断后续轮询。
        // 这里只做最低限度的标准错误输出，避免 IdlePoll 引入业务级日志依赖。
        // eslint-disable-next-line no-console
        console.error('[IdlePoll] poll() unexpected error:', err);
      });
    }, this.pollIntervalMs);
  }

  /**
   * 停止轮询。多次调用为幂等。
   *
   * 不会中断当前正在执行的任务；只是不再认领新任务。
   */
  stopPolling(): void {
    if (this.intervalHandle === null) {
      return;
    }
    clearInterval(this.intervalHandle);
    this.intervalHandle = null;
  }

  /** 是否处于轮询中（定时器已启动）。 */
  isPolling(): boolean {
    return this.intervalHandle !== null;
  }

  /** 设置自动认领开关。停止/启动定时器请使用 `start/stopPolling`。 */
  setAutoClaimEnabled(enabled: boolean): void {
    this.autoClaimEnabled = !!enabled;
  }

  // ── 私有 ──────────────────────────────────────────────────────

  /**
   * 单次轮询。会被 `setInterval` 周期性调用。
   *
   * 跳过条件：
   *  - 自动认领被关闭；
   *  - Agent 正在 streaming；
   *  - 上一轮 poll 还未结束。
   */
  private async poll(): Promise<void> {
    if (!this.autoClaimEnabled) return;
    if (this.agent.isStreaming) return;
    if (this.isPollingNow) return;

    this.isPollingNow = true;
    try {
      const candidates = await this.findClaimableTasks();
      const limit = Math.min(this.maxClaimPerPoll, candidates.length);
      for (let i = 0; i < limit; i++) {
        const task = candidates[i];
        try {
          await this.claimAndExecute(task);
        } catch (err) {
          // 单个任务失败不阻塞下一个候选 / 下一次轮询。
          // eslint-disable-next-line no-console
          console.error(
            `[IdlePoll] claimAndExecute failed for ${task.id}:`,
            err,
          );
        }
        // 任务执行期间 Agent 处于 streaming，本轮其余候选若也被并发的轮询
        // 触发会在 `agent.isStreaming` 检查中被跳过，故顺序处理已足够。
      }
    } catch (err) {
      // taskRegistry 读取等错误：忽略，不影响下一轮。
      // eslint-disable-next-line no-console
      console.error('[IdlePoll] poll() error:', err);
    } finally {
      this.isPollingNow = false;
    }
  }

  /** 找出所有可认领（pending/无 owner/依赖完成）的任务。 */
  private async findClaimableTasks(): Promise<TaskRecord[]> {
    const all = await this.taskRegistry.listTasks();
    const out: TaskRecord[] = [];
    for (const task of all) {
      if (task.status !== 'pending') continue;
      if (task.owner) continue;
      // canStart 是 async：依次检查依赖。
      const ready = await this.taskRegistry.canStart(task.id);
      if (ready) out.push(task);
    }
    return out;
  }

  /**
   * 认领任务并驱动 Agent 执行；执行结束后标记为 `completed`。
   */
  private async claimAndExecute(task: TaskRecord): Promise<void> {
    // 再次检查 streaming 状态（认领前的最后一道防线）。
    if (this.agent.isStreaming) return;

    await this.taskRegistry.updateTask(task.id, {
      status: 'in_progress',
      owner: this.agentName,
    });

    const userMessage: UserMessage = {
      role: 'user',
      content: [{ type: 'text', text: this.buildTaskPrompt(task) }],
      timestamp: Date.now(),
    };

    try {
      // `prompt()` 的 Promise 在本轮 agent 循环结束时 resolve；
      // 这等价于监听 `agent_end` 事件后再继续。
      await this.agent.prompt(userMessage);
      await this.taskRegistry.updateTask(task.id, { status: 'completed' });
    } catch (err) {
      // 任务执行失败：保持 in_progress 不强制回滚为 pending，
      // 由上层（人工或 SubagentSpawner）决定如何处置。
      // 这里仅向上抛出供 poll() 记录。
      throw err;
    }
  }

  /**
   * 构造交给 Agent 的任务提示文本。
   *
   * 输出形如：
   * ```
   * [Task task_xxx] 任务标题
   *
   * 详细描述...
   *
   * When done, confirm completion.
   * ```
   */
  private buildTaskPrompt(task: TaskRecord): string {
    const description = task.description?.trim() ?? '';
    const lines: string[] = [`[Task ${task.id}] ${task.subject}`];
    if (description.length > 0) {
      lines.push('', description);
    }
    lines.push('', 'When done, confirm completion.');
    return lines.join('\n');
  }
}

// ── 模块级工具 ──────────────────────────────────────────────────

/** 校验并返回正整数；非法或缺失时回退默认值。 */
function clampPositive(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

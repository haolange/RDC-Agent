/**
 * BackgroundTaskRunner — 后台异步任务执行器。
 *
 * 职责：
 * - 维护进程内后台任务表（id → BackgroundTask），跟踪每个任务的状态。
 * - 通过 `child_process.spawn`（shell: true）启动耗时命令，不阻塞调用方。
 * - 收集子进程 stdout/stderr 到统一的 output 字段，并在超长时截断。
 * - 当 AbortSignal 触发时，向子进程发送 SIGTERM 终止任务。
 * - 提供按需通知机制：`getCompletedResults()` 返回未通知的已完成任务并打标，
 *   `buildNotificationMessage()` 生成可注入到 Agent 上下文的 XML 文本。
 *
 * 设计要点：
 * - 单例：全局共享一个实例（通过 `getBackgroundTaskRunner()` 获取），
 *   方便在 BashTool 等工具调用点直接调度。
 * - 输出截断：单个任务的 output 上限为 10000 字符，超过时只保留最后 10000。
 * - 通知幂等：`notified` 字段避免相同任务被多次注入。
 */

import { randomBytes } from 'crypto';
import { processSupervisor, type SupervisedProcess } from '../../runtime/ProcessSupervisor';

/** 后台任务状态机。 */
export type BackgroundTaskStatus = 'running' | 'completed' | 'failed';

/** 单个后台任务的不可变快照。 */
export interface BackgroundTask {
  /** 形如 `bg_{timestamp}_{hex}` 的全局唯一 ID。 */
  id: string;
  /** 实际执行的 shell 命令。 */
  command: string;
  /** 子进程的工作目录。 */
  cwd: string;
  /** 当前状态。 */
  status: BackgroundTaskStatus;
  /** 合并后的 stdout + stderr 输出（超长会保留尾部）。 */
  output: string;
  /** 子进程退出码；未结束或被信号终止时可能为 undefined。 */
  exitCode?: number;
  /** 任务启动时间（epoch ms）。 */
  startedAt: number;
  /** 任务完成时间（epoch ms）；未结束时为 undefined。 */
  completedAt?: number;
  /** 是否已通过 `getCompletedResults()` 通知给 Agent。 */
  notified: boolean;
}

/** 单任务输出最大保留字符数。 */
const MAX_OUTPUT_CHARS = 10_000;
/** 通知消息中尾部输出片段长度。 */
const NOTIFICATION_TAIL_CHARS = 500;

/**
 * 后台任务执行器实现。
 *
 * 不直接对外 export 构造，所有访问通过 `getBackgroundTaskRunner()`
 * 获取单例（除非测试需要隔离实例）。
 */
export class BackgroundTaskRunner {
  /** 任务表：bgTaskId → BackgroundTask。 */
  private readonly tasks = new Map<string, BackgroundTask>();

  /** 子进程引用：bgTaskId → SupervisedProcess（用于 abort/kill）。 */
  private readonly children = new Map<string, SupervisedProcess>();

  /**
   * 启动一个后台任务。
   *
   * @param command shell 命令字符串
   * @param cwd 工作目录
   * @param signal 可选的 AbortSignal；触发后会 SIGTERM 子进程
   * @returns 新生成的 bgTaskId
   */
  startBackground(command: string, cwd: string, signal?: AbortSignal): string {
    const id = generateBgTaskId();
    const startedAt = Date.now();
    const task: BackgroundTask = {
      id,
      command,
      cwd,
      status: 'running',
      output: '',
      startedAt,
      notified: false,
    };
    this.tasks.set(id, task);

    let supervised: SupervisedProcess;
    try {
      supervised = processSupervisor.spawn('background', command, [], {
        cwd,
        shell: true,
        env: process.env,
        windowsHide: true,
        isolateProcessGroup: false,
        abortSignal: signal,
        ringBufferBytes: MAX_OUTPUT_CHARS * 2,
      });
    } catch (err) {
      this.markFinished(id, 'failed', undefined, formatSpawnError(err));
      return id;
    }
    this.children.set(id, supervised);

    const appendOutput = (chunk: Buffer | string): void => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      const current = this.tasks.get(id);
      if (!current) return;
      const next = current.output + text;
      current.output =
        next.length > MAX_OUTPUT_CHARS
          ? next.slice(next.length - MAX_OUTPUT_CHARS)
          : next;
    };

    supervised.child.stdout?.on('data', appendOutput);
    supervised.child.stderr?.on('data', appendOutput);

    void supervised.exit.then((info) => {
      const current = this.tasks.get(id);
      if (current && !current.output) {
        current.output = supervised.stdout.toString() || supervised.stderr.toString();
        if (current.output.length > MAX_OUTPUT_CHARS) {
          current.output = current.output.slice(current.output.length - MAX_OUTPUT_CHARS);
        }
      }
      if (info.reason === 'spawn_failed') {
        if (current) {
          current.output += `\n[spawn error] ${info.error?.message ?? 'spawn failed'}`;
        }
        this.markFinished(id, 'failed', undefined);
        return;
      }
      if (info.signal && current) {
        current.output += `\n[terminated by signal ${info.signal}]`;
        if (current.output.length > MAX_OUTPUT_CHARS) {
          current.output = current.output.slice(current.output.length - MAX_OUTPUT_CHARS);
        }
      }
      const finalStatus: BackgroundTaskStatus =
        info.code === 0 ? 'completed' : 'failed';
      this.markFinished(id, finalStatus, typeof info.code === 'number' ? info.code : undefined);
    });

    return id;
  }

  /** 查询任务状态；不存在返回 null。 */
  getStatus(bgTaskId: string): BackgroundTask | null {
    const task = this.tasks.get(bgTaskId);
    return task ? { ...task } : null;
  }

  /**
   * 获取所有"已完成且尚未通知"的任务，并将其标记为已通知。
   * 返回值是任务快照，调用方可安全持有。
   */
  getCompletedResults(): BackgroundTask[] {
    const ready: BackgroundTask[] = [];
    for (const task of this.tasks.values()) {
      if (task.status !== 'running' && task.notified === false) {
        task.notified = true;
        ready.push({ ...task });
      }
    }
    return ready;
  }

  /**
   * 构造给 Agent 的后台任务完成通知文本。
   * 调用此方法会消费掉所有"未通知的已完成任务"。
   * 如果当前没有待通知任务，返回 null。
   */
  buildNotificationMessage(): string | null {
    const finished = this.getCompletedResults();
    if (finished.length === 0) return null;
    const blocks = finished.map((task) => formatNotificationBlock(task));
    return blocks.join('\n');
  }

  /** 列出当前仍在运行的任务快照。 */
  listRunning(): BackgroundTask[] {
    const running: BackgroundTask[] = [];
    for (const task of this.tasks.values()) {
      if (task.status === 'running') {
        running.push({ ...task });
      }
    }
    return running;
  }

  /**
   * 清理已通知的非运行态任务，释放内存。
   * 不会清理仍在运行或尚未通知的任务。
   */
  cleanup(): void {
    for (const [id, task] of this.tasks) {
      if (task.status !== 'running' && task.notified === true) {
        this.tasks.delete(id);
        this.children.delete(id);
      }
    }
  }

  /** 内部：把任务推进到终止态并清理子进程引用。 */
  private markFinished(
    id: string,
    status: BackgroundTaskStatus,
    exitCode: number | undefined,
    extraOutput?: string,
  ): void {
    const task = this.tasks.get(id);
    if (!task) return;
    if (task.status !== 'running') return; // 幂等保护
    if (extraOutput) {
      const next = task.output + extraOutput;
      task.output =
        next.length > MAX_OUTPUT_CHARS
          ? next.slice(next.length - MAX_OUTPUT_CHARS)
          : next;
    }
    task.status = status;
    task.exitCode = exitCode;
    task.completedAt = Date.now();
    this.children.delete(id);
  }
}

/** 全局单例（懒加载）。 */
let singleton: BackgroundTaskRunner | null = null;

/**
 * 获取 BackgroundTaskRunner 单例。
 *
 * BashTool 等调用点通过此工厂函数取得 runner，避免显式注入依赖。
 */
export function getBackgroundTaskRunner(): BackgroundTaskRunner {
  if (singleton === null) {
    singleton = new BackgroundTaskRunner();
  }
  return singleton;
}

/** 仅用于测试：替换/重置全局 runner。 */
export function __setBackgroundTaskRunnerForTest(
  runner: BackgroundTaskRunner | null,
): void {
  singleton = runner;
}

/** 生成形如 `bg_{timestamp}_{hex}` 的任务 ID。 */
function generateBgTaskId(): string {
  const hex = randomBytes(4).toString('hex');
  return `bg_${Date.now()}_${hex}`;
}

/** 格式化 spawn 同步抛出的错误。 */
function formatSpawnError(err: unknown): string {
  if (err instanceof Error) {
    return `[spawn error] ${err.message}`;
  }
  return `[spawn error] ${String(err)}`;
}

/** 把单个已完成任务格式化成通知文本块。 */
function formatNotificationBlock(task: BackgroundTask): string {
  const tail =
    task.output.length > NOTIFICATION_TAIL_CHARS
      ? task.output.slice(task.output.length - NOTIFICATION_TAIL_CHARS)
      : task.output;
  const exitLine =
    typeof task.exitCode === 'number'
      ? `Exit code: ${task.exitCode}`
      : `Exit code: (none)`;
  return [
    `<bg_task_completed id="${task.id}">`,
    `Command: ${task.command}`,
    exitLine,
    `Output (last ${NOTIFICATION_TAIL_CHARS} chars):`,
    tail,
    `</bg_task_completed>`,
  ].join('\n');
}

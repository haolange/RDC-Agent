/**
 * 定时任务调度器（CronScheduler）。
 *
 * 维护一组 CronJob，按固定轮询周期判断当前时间是否命中各 job 的 cron 表达式；
 * 命中后将 prompt 加入待注入队列，由 AgentLoop 在每轮循环前消费。
 *
 * 主要特性：
 * - 内存调度 + 可选的磁盘持久化（durable）
 * - 同分钟去重（防止 1Hz 轮询导致一分钟内重复触发）
 * - one-shot job 触发后自动取消
 * - 单 job 抛错不会拖垮整个调度循环
 *
 * 该模块只在 main process 内部使用，不应被 renderer 直接 import。
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

import { matchesCron, parseCron } from './CronParser';

/**
 * 单个 cron 任务记录。
 */
export interface CronJob {
  /** 唯一 ID，格式 `cron_{timestamp}_{hex}`。 */
  id: string;
  /** 五段式 cron 表达式。 */
  cron: string;
  /** 命中后注入到 AgentLoop 的用户消息。 */
  prompt: string;
  /** 是否周期触发，false 时执行一次后自动取消。 */
  recurring: boolean;
  /** 是否跨会话持久化到磁盘。 */
  durable: boolean;
  /** 上次触发时间戳（ms）。 */
  lastRun?: number;
  /** 下次预计触发时间戳，仅作信息展示用，不参与调度。 */
  nextRun?: number;
  /** 创建时间戳（ms）。 */
  createdAt: number;
}

/**
 * CronScheduler 构造选项。
 */
export interface CronSchedulerOptions {
  /** 持久化目录，默认 `<cwd>/.rdc-agent/cron`。 */
  cronDir?: string;
  /** 轮询间隔（ms），默认 1000。 */
  pollIntervalMs?: number;
}

/** 持久化文件名。 */
const JOBS_FILE = 'jobs.json';

/** 默认持久化目录（相对当前工作目录）。 */
const DEFAULT_CRON_DIR = path.join('.rdc-agent', 'cron');

/** 默认轮询间隔（ms）。 */
const DEFAULT_POLL_INTERVAL_MS = 1000;

/**
 * 定时任务调度器。
 *
 * 使用方式：
 * ```ts
 * const scheduler = new CronScheduler();
 * await scheduler.loadDurableJobs();
 * scheduler.start();
 * scheduler.schedule({ cron: '0 9 * * *', prompt: '早安巡检', recurring: true, durable: true });
 * // 在 AgentLoop 每轮前：
 * const prompts = scheduler.getPendingPrompts();
 * // ...
 * scheduler.stop();
 * ```
 */
export class CronScheduler {
  private readonly cronDir: string;
  private readonly pollIntervalMs: number;
  private readonly jobs = new Map<string, CronJob>();
  private readonly pendingPrompts: string[] = [];
  /** 同分钟去重标记：jobId → "YYYY-M-D H:M"。 */
  private readonly lastFiredMarker = new Map<string, string>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: CronSchedulerOptions = {}) {
    this.cronDir = options.cronDir
      ? path.resolve(options.cronDir)
      : path.resolve(process.cwd(), DEFAULT_CRON_DIR);
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    if (this.pollIntervalMs <= 0) {
      throw new Error(
        `CronScheduler.pollIntervalMs must be > 0, got ${this.pollIntervalMs}`,
      );
    }
  }

  /**
   * 注册一个新的 cron 任务。
   *
   * 校验 cron 表达式合法性，生成 ID 并加入内存调度列表；若 durable=true
   * 则同步写入磁盘（异步 fire-and-forget）。
   *
   * @param input 不含 id/createdAt 的 job 描述
   * @returns 完整的 CronJob（含生成的 id 与 createdAt）
   * @throws 如果 cron 表达式不合法
   */
  schedule(input: Omit<CronJob, 'id' | 'createdAt'>): CronJob {
    // 校验：不合法时抛错
    parseCron(input.cron);

    const job: CronJob = {
      ...input,
      id: generateJobId(),
      createdAt: Date.now(),
    };
    this.jobs.set(job.id, job);

    if (job.durable) {
      void this.saveDurableJobs();
    }
    return job;
  }

  /**
   * 取消任务，从内存和持久化中移除。
   *
   * @returns 是否成功取消（不存在返回 false）
   */
  cancel(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    this.jobs.delete(jobId);
    this.lastFiredMarker.delete(jobId);
    if (job.durable) {
      void this.saveDurableJobs();
    }
    return true;
  }

  /**
   * 列出当前所有内存中的 job。
   */
  listJobs(): CronJob[] {
    return Array.from(this.jobs.values());
  }

  /**
   * 启动轮询定时器；重复调用是幂等的。
   */
  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => this.tick(), this.pollIntervalMs);
  }

  /**
   * 停止轮询定时器。stop() 后可再次 start()。
   */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * 取出并清空待注入的 prompts。
   *
   * 供 AgentLoop 在每轮循环开头调用，将 prompt 注入消息历史。
   */
  getPendingPrompts(): string[] {
    if (this.pendingPrompts.length === 0) return [];
    const out = this.pendingPrompts.slice();
    this.pendingPrompts.length = 0;
    return out;
  }

  /**
   * 从磁盘加载持久化任务（如果 jobs.json 不存在则静默跳过）。
   *
   * 会校验每个 job 的 cron 表达式，非法 job 将被忽略而不是抛错。
   */
  async loadDurableJobs(): Promise<void> {
    const filePath = path.join(this.cronDir, JOBS_FILE);
    let raw: string;
    try {
      raw = await fs.readFile(filePath, 'utf-8');
    } catch (err) {
      if (isNotFound(err)) return;
      throw err;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // 文件损坏：跳过加载，避免阻断主进程启动
      return;
    }
    if (!Array.isArray(parsed)) return;

    for (const entry of parsed) {
      if (!isPlainCronJob(entry)) continue;
      try {
        parseCron(entry.cron);
      } catch {
        continue;
      }
      // durable 加载进来一定是 durable=true，确保后续更新会回写
      this.jobs.set(entry.id, { ...entry, durable: true });
    }
  }

  /**
   * 保存所有 durable 任务到 `{cronDir}/jobs.json`。
   *
   * 会自动创建目录。该方法保证调用顺序内的最终一致：连续多次调用时
   * 写入内容均为当前内存快照，无序竞态影响最终结果一致性。
   */
  async saveDurableJobs(): Promise<void> {
    await fs.mkdir(this.cronDir, { recursive: true });
    const durable = Array.from(this.jobs.values()).filter((j) => j.durable);
    const content = JSON.stringify(durable, null, 2);
    await fs.writeFile(path.join(this.cronDir, JOBS_FILE), content, 'utf-8');
  }

  // ── 内部实现 ────────────────────────────────────────────────────────

  /**
   * 单次轮询：检查所有 job 是否命中当前时间。
   *
   * 单 job 内部异常被吞掉，防止一个坏 job 拖垮整个 setInterval 回调。
   */
  private tick(): void {
    const now = new Date();
    const marker = formatMinuteMarker(now);
    let durableMutated = false;

    for (const job of Array.from(this.jobs.values())) {
      try {
        if (!matchesCron(job.cron, now)) continue;
        if (this.lastFiredMarker.get(job.id) === marker) continue;

        this.lastFiredMarker.set(job.id, marker);
        this.pendingPrompts.push(job.prompt);
        job.lastRun = now.getTime();

        if (!job.recurring) {
          this.jobs.delete(job.id);
          this.lastFiredMarker.delete(job.id);
          if (job.durable) durableMutated = true;
        } else if (job.durable) {
          // recurring durable job 的 lastRun 也需回写
          durableMutated = true;
        }
      } catch {
        // 忽略单 job 错误，继续后续 job
      }
    }

    if (durableMutated) {
      void this.saveDurableJobs();
    }
  }
}

// ── 工具函数 ──────────────────────────────────────────────────────────

/**
 * 生成 `cron_{timestamp}_{hex}` 形式的唯一 ID。
 */
function generateJobId(): string {
  const ts = Date.now();
  const hex = randomBytes(4).toString('hex');
  return `cron_${ts}_${hex}`;
}

/**
 * 生成"年-月-日 时:分"形式的去重标记。
 */
function formatMinuteMarker(date: Date): string {
  return (
    `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()} ` +
    `${date.getHours()}:${date.getMinutes()}`
  );
}

/**
 * 判断错误是否为"文件不存在"。
 */
function isNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === 'ENOENT'
  );
}

/**
 * 持久化加载时的弱类型校验。
 */
function isPlainCronJob(value: unknown): value is CronJob {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.cron === 'string' &&
    typeof v.prompt === 'string' &&
    typeof v.recurring === 'boolean' &&
    typeof v.durable === 'boolean' &&
    typeof v.createdAt === 'number'
  );
}

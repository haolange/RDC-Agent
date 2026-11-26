/**
 * ErrorRecovery — 错误分类与恢复策略管理。
 *
 * 设计目标：
 *  - 输入：一次 LLM 调用产生的异常或非正常 stop_reason；
 *  - 输出：下一步建议动作（retry / escalate / compact / switch_model / abort 等）。
 *
 * 该模块是纯逻辑实现，不直接执行重试或调用 Provider。
 * 调用方（Agent 上层）负责按 RecoveryAction 调度具体行为。
 */

import { AppError } from '@shared/errors/appError';
import {
  isProviderEmptyStreamError,
  parseRetryAfterMs,
  ProviderHttpError,
  ProviderTimeoutError,
  ProviderWireFailureError,
} from '../providers/internal/http';
import { classifyProviderText, extractErrorStatus, type ErrorCategory } from './ErrorClassification';
import type { Model } from '../core/types';

// =====================================================================
// 类型
// =====================================================================

/** 恢复状态。 */
export interface RecoveryState {
  /** 恢复重试次数。 */
  recoveryCount: number;
  /** 连续过载错误计数。 */
  consecutiveOverloads: number;
  /** 是否已尝试过 reactive compact。 */
  hasAttemptedReactiveCompact: boolean;
  /** 当前使用的模型。 */
  currentModel: Model;
}

/** 恢复动作。 */
export type RecoveryAction =
  | { type: 'retry'; delayMs: number }
  | { type: 'reactive_compact' }
  | { type: 'switch_model'; fallbackModel: Model }
  | { type: 'continue_prompt' }
  | { type: 'abort'; reason: string };

const RECOVERY_ABORT_SNIPPET_MAX = 300;

export interface AgentRecoveryAbortFields {
  cause: Error;
  category: ErrorCategory;
  attempts: number;
  maxAttempts: number;
  lastStatus?: number;
  bodySnippet?: string;
  streamCode?: string;
}

/** Recovery abort：保留 cause 链与结构化诊断字段；`recoveryCategory` 是恢复分类，`category` 是 AppError 的失败类别。 */
export class AgentRecoveryAbortError extends AppError {
  declare readonly code: 'PROVIDER_STREAM_PROTOCOL_VIOLATION' | 'PROVIDER_STREAM_EMPTY' | 'AGENT_RECOVERY_ABORTED';
  readonly streamCode?: string;
  readonly recoveryCategory: ErrorCategory;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly lastStatus?: number;
  readonly bodySnippet?: string;

  constructor(message: string, fields: AgentRecoveryAbortFields) {
    super(
      fields.category === 'stream_protocol'
        ? 'PROVIDER_STREAM_PROTOCOL_VIOLATION'
        : fields.category === 'empty_stream'
          ? 'PROVIDER_STREAM_EMPTY'
          : 'AGENT_RECOVERY_ABORTED',
      message,
      { cause: fields.cause },
    );
    this.name = 'AgentRecoveryAbortError';
    this.recoveryCategory = fields.category;
    this.attempts = fields.attempts;
    this.maxAttempts = fields.maxAttempts;
    this.lastStatus = fields.lastStatus;
    this.bodySnippet = fields.bodySnippet !== undefined ? redactRecoverySnippet(fields.bodySnippet) : undefined;
    this.streamCode = fields.streamCode;
  }
}

export function isProviderStreamProtocolError(error: unknown): error is Error & { code?: string } {
  return error instanceof Error && error.name === 'ProviderStreamProtocolError';
}

function readStreamViolationCode(error: Error): string {
  return (
    readProviderStreamCode(error) ??
    (error instanceof AgentRecoveryAbortError ? error.streamCode : undefined) ??
    'PROVIDER_STREAM_PROTOCOL_VIOLATION'
  );
}

function readProviderStreamCode(error: Error): string | undefined {
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && code.startsWith('PROVIDER_STREAM_') ? code : undefined;
}

// =====================================================================
// 默认值
// =====================================================================

const DEFAULT_MAX_RETRIES = 3;
const EMPTY_STREAM_MAX_RETRIES = 1;
const DEFAULT_MAX_RECOVERY_RETRIES = 2;
const OVERLOAD_SWITCH_THRESHOLD = 3;
const RETRY_BASE_MS = 1000;
const RETRY_JITTER_MS = 500;
/** Longest provider-requested wait honoured inside a turn; a longer request ends the turn with its reason. */
export const MAX_RETRY_AFTER_MS = 60_000;

/** The provider's requested retry delay carried by the error or the errors it wraps. */
export function readRetryAfterMs(error: unknown): number | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    const requested = (current as { retryAfterMs?: unknown }).retryAfterMs;
    if (typeof requested === 'number' && Number.isFinite(requested) && requested >= 0) return requested;
    const headers = (current as { responseHeaders?: unknown }).responseHeaders;
    if (headers && typeof headers === 'object') {
      const record = headers as Record<string, string | undefined>;
      const parsed = parseRetryAfterMs({ get: (name) => record[name] ?? record[name.toLowerCase()] ?? null });
      if (parsed !== undefined) return parsed;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

// =====================================================================
// 错误恢复管理器
// =====================================================================

export class ErrorRecovery {
  private state: RecoveryState;
  private maxRetries: number;
  private maxRecoveryRetries: number;
  private fallbackModel?: Model;

  constructor(options: {
    primaryModel: Model;
    fallbackModel?: Model;
    maxRetries?: number;
    maxRecoveryRetries?: number;
  }) {
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.maxRecoveryRetries = options.maxRecoveryRetries ?? DEFAULT_MAX_RECOVERY_RETRIES;
    this.fallbackModel = options.fallbackModel;
    this.state = {
      recoveryCount: 0,
      consecutiveOverloads: 0,
      hasAttemptedReactiveCompact: false,
      currentModel: options.primaryModel,
    };
  }

  /** 分类错误。 */
  classifyError(error: Error): ErrorCategory {
    if (isProviderEmptyStreamError(error) || readErrorCode(error) === 'PROVIDER_STREAM_EMPTY') {
      return 'empty_stream';
    }
    if (error instanceof AgentRecoveryAbortError) {
      return error.recoveryCategory;
    }
    if (isProviderStreamProtocolError(error)) {
      return 'stream_protocol';
    }
    if (findProviderTimeoutError(error)) {
      return 'network_error';
    }
    const wire = findProviderWireFailureError(error);
    const raw = `${error.message} ${error.name} ${wire?.bodyText ?? ''}`.toLowerCase();
    return classifyProviderText(raw, extractErrorStatus(error));
  }

  /** 判断是否为 prompt too long 错误。 */
  isPromptTooLong(error: Error): boolean {
    return this.classifyError(error) === 'prompt_too_long';
  }

  /**
   * 决定恢复动作。
   *
   * 优先级见类型声明处的列表（rate → overload → prompt → tokens → auth → network → server）。
   */
  decide(error: Error | null, stopReason?: string): RecoveryAction {
    // 1. stop_reason === 'length' 优先按输出上限处理：先压缩，再续写。
    if (stopReason === 'length') {
      return this.decideOutputLimit();
    }

    if (!error) {
      return { type: 'abort', reason: 'no error and no recoverable stop_reason' };
    }

    const category = this.classifyError(error);

    switch (category) {
      case 'rate_limit':
        return this.decideRateLimit(error);
      case 'overloaded':
        return this.decideOverloaded(error);
      case 'prompt_too_long':
        return this.decidePromptTooLong();
      case 'max_tokens':
        return this.decideOutputLimit();
      case 'auth_error':
        return { type: 'abort', reason: 'authentication failed; check API key' };
      case 'empty_stream':
        return this.decideEmptyStream();
      case 'network_error':
      case 'server_error':
        return this.decideTransient(error, category);
      case 'stream_protocol':
        return { type: 'abort', reason: `${readStreamViolationCode(error)}: ${error.message}` };
      case 'unknown':
      default:
        return { type: 'abort', reason: `unrecoverable error: ${error.message}` };
    }
  }

  private decideRateLimit(error: Error): RecoveryAction {
    if (this.state.recoveryCount >= this.maxRetries) return { type: 'abort', reason: 'rate limit retries exhausted' };
    return this.retryHonouringProvider(error, 'rate limit');
  }

  private decideOverloaded(error: Error): RecoveryAction {
    this.state.consecutiveOverloads += 1;
    const fallback = this.fallbackModel;
    if (
      this.state.consecutiveOverloads >= OVERLOAD_SWITCH_THRESHOLD &&
      fallback &&
      fallback.id !== this.state.currentModel.id
    ) {
      this.state.currentModel = fallback;
      this.state.consecutiveOverloads = 0;
      return { type: 'switch_model', fallbackModel: fallback };
    }
    if (this.state.recoveryCount >= this.maxRetries) {
      return { type: 'abort', reason: 'overloaded retries exhausted and no fallback available' };
    }
    return this.retryHonouringProvider(error, 'overloaded');
  }

  private decidePromptTooLong(): RecoveryAction {
    if (!this.state.hasAttemptedReactiveCompact) return { type: 'reactive_compact' };
    return { type: 'abort', reason: 'prompt too long even after reactive compact' };
  }

  private decideEmptyStream(): RecoveryAction {
    if (this.state.recoveryCount >= EMPTY_STREAM_MAX_RETRIES) {
      return { type: 'abort', reason: 'empty_stream retries exhausted' };
    }
    return { type: 'retry', delayMs: this.getRetryDelay(this.state.recoveryCount) };
  }

  /**
   * Network and server failures retry with backoff. A provider timeout that fired after the stream had produced model
   * output is not retried: a retry would discard that output and re-run the whole request, and the provider has
   * already shown it was slow, not unreachable.
   */
  private decideTransient(error: Error, category: 'network_error' | 'server_error'): RecoveryAction {
    const timeout = findProviderTimeoutError(error);
    if (timeout?.afterContent) {
      return { type: 'abort', reason: `provider stream ${timeout.phase} timeout after output; not retried` };
    }
    if (this.state.recoveryCount >= this.maxRetries) {
      return { type: 'abort', reason: `${category} retries exhausted` };
    }
    return this.retryHonouringProvider(error, category);
  }

  /** 计算指数退避（含 0–500ms 抖动）。 */
  /** Backs off at least as long as the provider asked; a wait beyond the in-turn window ends the turn instead. */
  private retryHonouringProvider(error: Error, label: string): RecoveryAction {
    const backoff = this.getRetryDelay(this.state.recoveryCount);
    const requested = readRetryAfterMs(error);
    if (requested === undefined) return { type: 'retry', delayMs: backoff };
    if (requested > MAX_RETRY_AFTER_MS) {
      return { type: 'abort', reason: `${label}: provider asked to retry after ${Math.ceil(requested / 1000)}s` };
    }
    return { type: 'retry', delayMs: Math.max(backoff, requested) };
  }

  getRetryDelay(attempt: number): number {
    const exp = Math.pow(2, Math.max(0, attempt));
    const base = RETRY_BASE_MS * exp;
    const jitter = Math.floor(Math.random() * RETRY_JITTER_MS);
    return base + jitter;
  }

  /** 重置状态（保留 currentModel）。 */
  reset(): void {
    this.state = {
      recoveryCount: 0,
      consecutiveOverloads: 0,
      hasAttemptedReactiveCompact: false,
      currentModel: this.state.currentModel,
    };
  }

  /** 获取当前模型。 */
  getCurrentModel(): Model {
    return this.state.currentModel;
  }

  /** 标记 reactive compact 已尝试。 */
  markReactiveCompactAttempted(): void {
    this.state.hasAttemptedReactiveCompact = true;
    this.state.recoveryCount += 1;
  }

  /** 用于上层在执行重试后递增计数。 */
  noteRetryAttempt(): void {
    this.state.recoveryCount += 1;
  }

  /** 暴露状态快照，便于上层观察 / 测试。 */
  getState(): Readonly<RecoveryState> {
    return { ...this.state };
  }

  /** 该分类允许的总尝试次数（含首次调用）。 */
  getMaxAttempts(category: ErrorCategory): number {
    if (category === 'empty_stream') {
      return EMPTY_STREAM_MAX_RETRIES + 1;
    }
    if (category === 'network_error' || category === 'server_error' || category === 'rate_limit') {
      return this.maxRetries + 1;
    }
    return 1;
  }

  createAbortError(original: Error, reason: string): AgentRecoveryAbortError {
    const category = this.classifyError(original);
    const http = findProviderHttpError(original);
    const wire = findProviderWireFailureError(original);
    return new AgentRecoveryAbortError(`[Recovery abort] ${reason}`, {
      cause: original,
      category,
      attempts: this.state.recoveryCount + 1,
      maxAttempts: findProviderTimeoutError(original)?.afterContent ? 1 : this.getMaxAttempts(category),
      lastStatus: http?.status,
      bodySnippet: http?.bodyText ?? wire?.bodyText ?? wire?.message ?? original.message,
      streamCode:
        category === 'stream_protocol'
          ? (readProviderStreamCode(original) ??
            (original instanceof AgentRecoveryAbortError ? original.streamCode : undefined))
          : undefined,
    });
  }

  private decideOutputLimit(): RecoveryAction {
    if (!this.state.hasAttemptedReactiveCompact) {
      return { type: 'reactive_compact' };
    }
    if (this.state.recoveryCount < this.maxRecoveryRetries) {
      return { type: 'continue_prompt' };
    }
    return {
      type: 'abort',
      reason: 'max_tokens reached and recovery limit exhausted',
    };
  }
}

function readErrorCode(error: Error): string | undefined {
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

export function findProviderHttpError(error: unknown): ProviderHttpError | undefined {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    if (current instanceof ProviderHttpError) {
      return current;
    }
    current = current.cause;
  }
  return undefined;
}

export function findProviderTimeoutError(error: unknown): ProviderTimeoutError | undefined {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    if (current instanceof ProviderTimeoutError) {
      return current;
    }
    current = current.cause;
  }
  return undefined;
}

export function findProviderWireFailureError(error: unknown): ProviderWireFailureError | undefined {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    if (current instanceof ProviderWireFailureError) {
      return current;
    }
    current = current.cause;
  }
  return undefined;
}

export function redactRecoverySnippet(raw: string): string {
  return raw
    .replace(/(Bearer\s+)[^\s"'`,;)}]+/gi, '$1[redacted]')
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret)["'\s:=]+)[^"',;\s)}]+/gi, '$1[redacted]')
    .slice(0, RECOVERY_ABORT_SNIPPET_MAX);
}

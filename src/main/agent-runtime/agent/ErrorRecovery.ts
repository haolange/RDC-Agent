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

import type { Model } from '../core/types';
import {
  isProviderEmptyStreamError,
  ProviderHttpError,
  ProviderWireFailureError,
} from '../providers/internal/http';

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

/** 错误分类。 */
export type ErrorCategory =
  | 'rate_limit'
  | 'overloaded'
  | 'prompt_too_long'
  | 'max_tokens'
  | 'auth_error'
  | 'network_error'
  | 'server_error'
  | 'empty_stream'
  | 'stream_protocol'
  | 'unknown';

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

/** Recovery abort：保留 cause 链与结构化诊断字段。 */
export class AgentRecoveryAbortError extends Error {
  readonly code: string;
  readonly streamCode?: string;
  readonly category: ErrorCategory;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly lastStatus?: number;
  readonly bodySnippet?: string;

  constructor(message: string, fields: AgentRecoveryAbortFields) {
    super(message, { cause: fields.cause });
    this.name = 'AgentRecoveryAbortError';
    this.category = fields.category;
    this.attempts = fields.attempts;
    this.maxAttempts = fields.maxAttempts;
    this.lastStatus = fields.lastStatus;
    this.bodySnippet = fields.bodySnippet !== undefined
      ? redactRecoverySnippet(fields.bodySnippet)
      : undefined;
    this.streamCode = fields.streamCode;
    this.code = fields.category === 'stream_protocol'
      ? 'PROVIDER_STREAM_PROTOCOL_VIOLATION'
      : fields.category === 'empty_stream'
        ? 'PROVIDER_STREAM_EMPTY'
        : 'AGENT_RECOVERY_ABORTED';
  }
}

export function isProviderStreamProtocolError(error: unknown): error is Error & { code?: string } {
  return error instanceof Error && error.name === 'ProviderStreamProtocolError';
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
    this.maxRecoveryRetries =
      options.maxRecoveryRetries ?? DEFAULT_MAX_RECOVERY_RETRIES;
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
      return error.category;
    }
    if (isProviderStreamProtocolError(error)) {
      return 'stream_protocol';
    }
    const wire = findProviderWireFailureError(error);
    const raw = `${error.message ?? ''} ${error.name ?? ''} ${wire?.bodyText ?? ''}`.toLowerCase();
    const status = this.extractStatusCode(error);

    // prompt too long / context length
    if (
      raw.includes('context_length_exceeded') ||
      raw.includes('context length') ||
      raw.includes('maximum context length') ||
      (raw.includes('prompt') && raw.includes('long')) ||
      (raw.includes('input') && raw.includes('too') && raw.includes('long'))
    ) {
      return 'prompt_too_long';
    }

    // rate limit
    if (status === 429 || (raw.includes('rate') && raw.includes('limit'))) {
      return 'rate_limit';
    }

    // overloaded
    if (
      status === 529 ||
      status === 503 ||
      raw.includes('overloaded') ||
      raw.includes('service unavailable')
      || raw.includes('at capacity')
      || raw.includes('high demand')
    ) {
      return 'overloaded';
    }

    // auth
    if (
      status === 401 ||
      status === 403 ||
      raw.includes('unauthorized') ||
      raw.includes('forbidden') ||
      raw.includes('invalid api key') ||
      raw.includes('authentication')
    ) {
      return 'auth_error';
    }

    // network
    if (
      raw.includes('econnrefused') ||
      raw.includes('econnreset') ||
      raw.includes('etimedout') ||
      raw.includes('enotfound') ||
      raw.includes('network') ||
      raw.includes('timeout') ||
      raw.includes('aborterror') ||
      raw.includes('socket')
    ) {
      return 'network_error';
    }

    // server error
    if ((status !== undefined && status >= 500) || raw.includes('internal server')) {
      return 'server_error';
    }

    return 'unknown';
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
      case 'rate_limit': {
        if (this.state.recoveryCount >= this.maxRetries) {
          return {
            type: 'abort',
            reason: 'rate limit retries exhausted',
          };
        }
        return {
          type: 'retry',
          delayMs: this.getRetryDelay(this.state.recoveryCount),
        };
      }

      case 'overloaded': {
        this.state.consecutiveOverloads += 1;
        if (
          this.state.consecutiveOverloads >= OVERLOAD_SWITCH_THRESHOLD &&
          this.fallbackModel &&
          this.fallbackModel.id !== this.state.currentModel.id
        ) {
          const fallback = this.fallbackModel;
          this.state.currentModel = fallback;
          this.state.consecutiveOverloads = 0;
          return { type: 'switch_model', fallbackModel: fallback };
        }
        if (this.state.recoveryCount >= this.maxRetries) {
          return {
            type: 'abort',
            reason: 'overloaded retries exhausted and no fallback available',
          };
        }
        return {
          type: 'retry',
          delayMs: this.getRetryDelay(this.state.recoveryCount),
        };
      }

      case 'prompt_too_long': {
        if (!this.state.hasAttemptedReactiveCompact) {
          return { type: 'reactive_compact' };
        }
        return {
          type: 'abort',
          reason: 'prompt too long even after reactive compact',
        };
      }

      case 'max_tokens': {
        return this.decideOutputLimit();
      }

      case 'auth_error': {
        return {
          type: 'abort',
          reason: 'authentication failed; check API key',
        };
      }

      case 'empty_stream': {
        if (this.state.recoveryCount >= EMPTY_STREAM_MAX_RETRIES) {
          return {
            type: 'abort',
            reason: 'empty_stream retries exhausted',
          };
        }
        return {
          type: 'retry',
          delayMs: this.getRetryDelay(this.state.recoveryCount),
        };
      }

      case 'network_error':
      case 'server_error': {
        if (this.state.recoveryCount >= this.maxRetries) {
          return {
            type: 'abort',
            reason: `${category} retries exhausted`,
          };
        }
        return {
          type: 'retry',
          delayMs: this.getRetryDelay(this.state.recoveryCount),
        };
      }

      case 'stream_protocol': {
        const streamCode = readProviderStreamCode(error)
          ?? (error instanceof AgentRecoveryAbortError ? error.streamCode : undefined)
          ?? 'PROVIDER_STREAM_PROTOCOL_VIOLATION';
        return {
          type: 'abort',
          reason: `${streamCode}: ${error.message}`,
        };
      }

      case 'unknown':
      default: {
        return { type: 'abort', reason: `unrecoverable error: ${error.message}` };
      }
    }
  }

  /** 计算指数退避（含 0–500ms 抖动）。 */
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
      maxAttempts: this.getMaxAttempts(category),
      lastStatus: http?.status,
      bodySnippet: http?.bodyText ?? wire?.bodyText ?? wire?.message ?? original.message,
      streamCode: category === 'stream_protocol'
        ? readProviderStreamCode(original)
          ?? (original instanceof AgentRecoveryAbortError ? original.streamCode : undefined)
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

  // -------------------------------------------------------------------
  // 内部
  // -------------------------------------------------------------------

  private extractStatusCode(error: Error): number | undefined {
    // 兼容多种 SDK：err.status / err.statusCode / err.response.status
    const e = error as unknown as Record<string, unknown>;
    const direct = (e.status ?? e.statusCode) as number | undefined;
    if (typeof direct === 'number') return direct;
    const response = e.response as Record<string, unknown> | undefined;
    if (response && typeof response.status === 'number') {
      return response.status;
    }
    // 从错误消息中尝试解析：例如 "429 Too Many Requests"
    const match = error.message?.match(/\b(4\d{2}|5\d{2})\b/);
    if (match) {
      const code = Number(match[1]);
      if (!Number.isNaN(code)) return code;
    }
    return undefined;
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

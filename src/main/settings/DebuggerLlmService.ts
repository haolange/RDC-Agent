import type { AgentRole } from '@shared/types/agent';
import type { ConversationTurnControls } from '@shared/types/modelCapability';
import type {
  ContextUsageBreakdownEntry,
  ContextUsageBreakdownId,
  RunContextUsageReadResult,
  RunContextUsageRequest,
  RunContextUsageSummary,
} from '@shared/types/session';
import type { WorkflowStage } from '@shared/types/workflow';
import { cacheHitRatePercent } from '../agent-runtime/providers/internal/normalizeCacheUsage';
import { workflowProjectionPublisher } from '../workflow/debugger/WorkflowProjectionPublisher';
import { storageAdapter } from '../sessions/StorageAdapter';
import { planEffectiveModelRequest } from './EffectiveModelResolver';
import { settingsService } from './SettingsService';

export type LlmAuditStage = WorkflowStage | 'plan' | 'report';

/** 一次 LLM call 的成本明细（美元）。 */
export interface LlmUsageCost {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  total: number;
}

export interface RunLlmExecutionSummary {
  providerId: string;
  modelId: string;
  sessionId?: string | null;
  successfulCallCount: number;
  failedCallCount: number;
  firstRequestId?: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens?: number;
  totalCacheWriteTokens?: number;
  totalCacheHitTokens?: number;
  totalCacheMissTokens?: number;
  lastTurnCacheHitTokens?: number;
  lastTurnCacheMissTokens?: number;
  totalReasoningTokens?: number;
  /** 本 run 累计成本（美元）；无定价遥测时缺省。 */
  totalCost?: number;
  /** 最近一次 LLM call 的成本明细；无该轮定价遥测时缺省。 */
  lastTurnCost?: LlmUsageCost;
  lastOccupiedTokens?: number;
  lastPromptBreakdown?: ContextUsageBreakdownEntry[] | null;
  lastSnapshotAt?: number | null;
  routesUsed: Array<{
    agentId: AgentRole;
    stage: LlmAuditStage;
    providerId: string;
    modelId: string;
    requestId?: string;
    status: 'ok' | 'error';
  }>;
}

const NON_OCCUPYING_BREAKDOWN_IDS = new Set<ContextUsageBreakdownId>([
  'mcp_tools_deferred',
  'builtin_tools_deferred',
]);

function buildScaledBreakdown(
  raw: ContextUsageBreakdownEntry[] | null,
  occupiedTokens: number,
  contextWindowTokens: number | null,
): ContextUsageBreakdownEntry[] | null {
  if (!raw || raw.length === 0) return null;
  const occupying = raw.filter((entry) => !NON_OCCUPYING_BREAKDOWN_IDS.has(entry.id));
  const passthrough = raw.filter((entry) => NON_OCCUPYING_BREAKDOWN_IDS.has(entry.id));
  const estimateSum = occupying.reduce((total, entry) => total + entry.tokens, 0);
  const scaleFactor = estimateSum > 0 && occupiedTokens > 0 ? occupiedTokens / estimateSum : 1;
  const scaled = occupying.map((entry) => ({
    id: entry.id,
    tokens: Math.max(0, Math.round(entry.tokens * scaleFactor)),
    ...(entry.count !== undefined ? { count: entry.count } : {}),
  }));
  scaled.push(...passthrough.map((entry) => ({
    id: entry.id,
    tokens: Math.max(0, entry.tokens),
    ...(entry.count !== undefined ? { count: entry.count } : {}),
  })));
  if (contextWindowTokens) {
    scaled.push({ id: 'free', tokens: Math.max(0, contextWindowTokens - occupiedTokens) });
  }
  return scaled;
}

function positiveTokenOrOmit(value: number | undefined): number | undefined {
  return typeof value === 'number' && value > 0 ? value : undefined;
}
function hasMaterialProviderUsageTelemetry(usage: {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  cacheHitTokens?: number;
  cacheMissTokens?: number;
  reasoningTokens?: number;
  cost?: LlmUsageCost;
}): boolean {
  return [
    usage.inputTokens,
    usage.outputTokens,
    usage.cacheReadTokens,
    usage.cacheWriteTokens,
    usage.cacheHitTokens,
    usage.cacheMissTokens,
    usage.reasoningTokens,
    usage.cost?.total,
  ].some((value) => typeof value === 'number' && value > 0);
}


function isSubagentSessionId(sessionId: string | null | undefined): boolean {
  return Boolean(sessionId && sessionId.includes('::subagent::'));
}

/**
 * Aggregates usage emitted by the canonical Agent runtime.
 * Provider requests are intentionally not implemented here: every call must travel through
 * AgentOrchestrator and its PromptPlan -> RequestEnvelope -> RequestPlan pipeline.
 */
export class DebuggerLlmService {
  private readonly runSummaries = new Map<string, RunLlmExecutionSummary>();
  private readonly latestUsageKeysBySession = new Map<string, string>();

  resetRunSummary(runId: string): void {
    const summary = this.runSummaries.get(runId);
    this.runSummaries.delete(runId);
    if (summary?.sessionId && this.latestUsageKeysBySession.get(summary.sessionId) === runId) {
      this.latestUsageKeysBySession.delete(summary.sessionId);
    }
  }

  getRunSummary(runId: string): RunLlmExecutionSummary | null {
    const summary = this.runSummaries.get(runId);
    return summary ? { ...summary, routesUsed: summary.routesUsed.map((entry) => ({ ...entry })) } : null;
  }

  getSessionContextUsage(request: RunContextUsageRequest): RunContextUsageReadResult {
    if (isSubagentSessionId(request.sessionId)) {
      return { usage: null, stale: false };
    }

    if (request.runId) {
      const inMemory = this.runSummaries.get(request.runId);
      if (inMemory?.sessionId === request.sessionId) {
        return { usage: this.toContextUsageSummary(request.runId, inMemory), stale: false };
      }
      const persisted = this.readPersistedContextUsage(request.sessionId);
      return {
        usage: persisted?.runId === request.runId ? persisted : null,
        stale: persisted?.runId === request.runId,
      };
    }

    const latestKey = this.latestUsageKeysBySession.get(request.sessionId);
    const inMemory = latestKey ? this.runSummaries.get(latestKey) : null;
    if (latestKey && inMemory?.sessionId === request.sessionId) {
      return { usage: this.toContextUsageSummary(latestKey, inMemory), stale: false };
    }

    const persisted = this.readPersistedContextUsage(request.sessionId);
    return { usage: persisted, stale: persisted !== null };
  }

  recordAgentTurnUsage(params: {
    runId?: string;
    turnId: string;
    sessionId?: string | null;
    providerId: string;
    modelId: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    cacheHitTokens?: number;
    cacheMissTokens?: number;
    reasoningTokens?: number;
    cost?: LlmUsageCost;
    precomputedBreakdown: ContextUsageBreakdownEntry[];
  }): void {
    if (!params.sessionId || isSubagentSessionId(params.sessionId) || !hasMaterialProviderUsageTelemetry(params)) return;
    const key = params.runId ?? params.turnId;
    const existing = this.runSummaries.get(key) ?? {
      providerId: params.providerId,
      modelId: params.modelId,
      sessionId: params.sessionId,
      successfulCallCount: 0,
      failedCallCount: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      routesUsed: [],
    };
    existing.providerId = params.providerId;
    existing.modelId = params.modelId;
    if (params.sessionId) existing.sessionId = params.sessionId;
    existing.successfulCallCount += 1;
    existing.totalInputTokens += params.inputTokens;
    existing.totalOutputTokens += params.outputTokens;
    if (typeof params.cacheReadTokens === 'number') {
      existing.totalCacheReadTokens = (existing.totalCacheReadTokens ?? 0) + params.cacheReadTokens;
    }
    if (typeof params.cacheWriteTokens === 'number') {
      existing.totalCacheWriteTokens = (existing.totalCacheWriteTokens ?? 0) + params.cacheWriteTokens;
    }
    const hasCacheStats = typeof params.cacheHitTokens === 'number'
      || typeof params.cacheMissTokens === 'number';
    if (hasCacheStats) {
      const hit = params.cacheHitTokens ?? 0;
      const miss = params.cacheMissTokens ?? 0;
      existing.totalCacheHitTokens = (existing.totalCacheHitTokens ?? 0) + hit;
      existing.totalCacheMissTokens = (existing.totalCacheMissTokens ?? 0) + miss;
      existing.lastTurnCacheHitTokens = hit;
      existing.lastTurnCacheMissTokens = miss;
    } else {
      // Latest LLM call had no cache telemetry — clear last-turn only; keep run totals.
      existing.lastTurnCacheHitTokens = undefined;
      existing.lastTurnCacheMissTokens = undefined;
    }
    if (typeof params.reasoningTokens === 'number') {
      existing.totalReasoningTokens = (existing.totalReasoningTokens ?? 0) + params.reasoningTokens;
    }
    if (params.cost) {
      existing.totalCost = (existing.totalCost ?? 0) + params.cost.total;
      existing.lastTurnCost = params.cost;
    } else {
      // 最近一次 call 无成本遥测——仅清除 last-turn，保留 run 累计。
      existing.lastTurnCost = undefined;
    }
    existing.lastOccupiedTokens = params.inputTokens;
    existing.lastPromptBreakdown = params.precomputedBreakdown;
    existing.lastSnapshotAt = Date.now();
    this.runSummaries.set(key, existing);
    this.latestUsageKeysBySession.set(params.sessionId, key);
    this.persistRunUsage(key, params.sessionId);
    this.broadcastRunUsage(key);
  }

  private readPersistedContextUsage(sessionId: string): RunContextUsageSummary | null {
    const usage = storageAdapter.readSessionUsage(sessionId);
    return usage && hasMaterialProviderUsageTelemetry(usage) ? usage : null;
  }

  private toContextUsageSummary(key: string, summary: RunLlmExecutionSummary): RunContextUsageSummary {
    const turnControls = this.resolveSessionTurnControls(summary);
    const planning = planEffectiveModelRequest({
      providerId: summary.providerId,
      modelId: summary.modelId,
      settings: settingsService.getAll(),
      controls: turnControls ?? undefined,
    });
    const contextWindowTokens = planning.ok ? planning.plan.contextBudgetTokens : 0;
    const occupiedTokens = summary.lastOccupiedTokens ?? 0;
    const hasCacheStats = typeof summary.totalCacheHitTokens === 'number'
      || typeof summary.totalCacheMissTokens === 'number';
    const cacheHitTokens = hasCacheStats ? (summary.totalCacheHitTokens ?? 0) : undefined;
    const cacheMissTokens = hasCacheStats ? (summary.totalCacheMissTokens ?? 0) : undefined;
    const lastHit = summary.lastTurnCacheHitTokens;
    const lastMiss = summary.lastTurnCacheMissTokens;
    const hasLastTurnCache = typeof lastHit === 'number' || typeof lastMiss === 'number';
    const lastTurnHit = hasLastTurnCache ? (lastHit ?? 0) : undefined;
    const lastTurnMiss = hasLastTurnCache ? (lastMiss ?? 0) : undefined;
    const lastTurnRate = hasLastTurnCache
      ? cacheHitRatePercent(lastTurnHit ?? 0, lastTurnMiss ?? 0)
      : undefined;
    const cumulativeRate = hasCacheStats
      ? cacheHitRatePercent(cacheHitTokens ?? 0, cacheMissTokens ?? 0)
      : undefined;
    return {
      runId: key,
      providerId: summary.providerId,
      modelId: summary.modelId,
      inputTokens: summary.totalInputTokens,
      outputTokens: summary.totalOutputTokens,
      totalTokens: summary.totalInputTokens + summary.totalOutputTokens,
      contextWindowTokens,
      usagePercent: contextWindowTokens > 0
        ? Math.min(100, Math.max(0, Math.round((occupiedTokens / contextWindowTokens) * 100)))
        : 0,
      occupiedTokens,
      breakdown: buildScaledBreakdown(summary.lastPromptBreakdown ?? null, occupiedTokens, contextWindowTokens || null),
      snapshotAt: summary.lastSnapshotAt ?? null,
      ...(positiveTokenOrOmit(summary.totalCacheReadTokens) !== undefined
        ? { cacheReadTokens: positiveTokenOrOmit(summary.totalCacheReadTokens) }
        : {}),
      ...(positiveTokenOrOmit(summary.totalCacheWriteTokens) !== undefined
        ? { cacheWriteTokens: positiveTokenOrOmit(summary.totalCacheWriteTokens) }
        : {}),
      ...(cacheHitTokens !== undefined ? { cacheHitTokens } : {}),
      ...(cacheMissTokens !== undefined ? { cacheMissTokens } : {}),
      ...(lastTurnHit !== undefined ? { lastTurnCacheHitTokens: lastTurnHit } : {}),
      ...(lastTurnMiss !== undefined ? { lastTurnCacheMissTokens: lastTurnMiss } : {}),
      ...(cacheHitTokens !== undefined ? { cacheSavedTokens: cacheHitTokens } : {}),
      ...(lastTurnRate !== undefined ? { lastTurnCacheHitRate: lastTurnRate } : {}),
      ...(cumulativeRate !== undefined ? { cumulativeCacheHitRate: cumulativeRate } : {}),
      ...(positiveTokenOrOmit(summary.totalReasoningTokens) !== undefined
        ? { reasoningTokens: positiveTokenOrOmit(summary.totalReasoningTokens) }
        : {}),
      ...(summary.lastTurnCost ? { cost: summary.lastTurnCost } : {}),
      ...(typeof summary.totalCost === 'number' && summary.totalCost > 0
        ? { cumulativeCost: summary.totalCost }
        : {}),
    };
  }

  private resolveSessionTurnControls(summary: RunLlmExecutionSummary): ConversationTurnControls | null {
    return summary.sessionId ? storageAdapter.readSession(summary.sessionId)?.turnControls ?? null : null;
  }

  private contextUsageForKey(key: string): RunContextUsageSummary | null {
    const summary = this.runSummaries.get(key);
    return summary ? this.toContextUsageSummary(key, summary) : null;
  }

  private persistRunUsage(key: string, sessionId: string): void {
    const usage = this.contextUsageForKey(key);
    if (usage) storageAdapter.writeSessionUsage(sessionId, usage);
  }

  private broadcastRunUsage(key: string): void {
    const summary = this.runSummaries.get(key);
    if (!summary?.sessionId) return;

    const session = storageAdapter.readSession(summary.sessionId);
    const usage = this.contextUsageForKey(key);
    if (!session || !usage) return;

    workflowProjectionPublisher.publishRunUsage({
      projectId: session.projectId,
      sessionId: session.sessionId,
    }, usage);
  }
}

export const debuggerLlmService = new DebuggerLlmService();

import type { AgentRole } from '@shared/types/agent';
import type { ConversationTurnControls } from '@shared/types/modelCapability';
import type {
  ContextUsageBreakdownEntry,
  ContextUsageBreakdownId,
  RunContextUsageSummary,
} from '@shared/types/session';
import type { WorkflowStage } from '@shared/types/workflow';
import { workflowProjectionPublisher } from '../workflow/debugger/WorkflowProjectionPublisher';
import { storageAdapter } from '../sessions/StorageAdapter';
import { planEffectiveModelRequest } from './EffectiveModelResolver';
import { settingsService } from './SettingsService';

export type LlmAuditStage = WorkflowStage | 'plan' | 'report';

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
  totalReasoningTokens?: number;
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

  resetRunSummary(runId: string): void {
    this.runSummaries.delete(runId);
    this.broadcastRunUsage(runId);
  }

  getRunSummary(runId: string): RunLlmExecutionSummary | null {
    const summary = this.runSummaries.get(runId);
    return summary ? { ...summary, routesUsed: summary.routesUsed.map((entry) => ({ ...entry })) } : null;
  }

  getRunContextUsage(runId: string, fallbackSessionId?: string | null): RunContextUsageSummary | null {
    const summary = this.runSummaries.get(runId);
    return summary
      ? this.toContextUsageSummary(runId, summary)
      : this.readPersistedUsage(runId, fallbackSessionId);
  }

  recordAgentTurnUsage(params: {
    runId?: string;
    sessionId?: string | null;
    providerId: string;
    modelId: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    reasoningTokens?: number;
    precomputedBreakdown: ContextUsageBreakdownEntry[];
  }): void {
    const key = params.runId ?? params.sessionId;
    if (!key) return;
    const existing = this.runSummaries.get(key) ?? {
      providerId: params.providerId,
      modelId: params.modelId,
      sessionId: params.sessionId ?? null,
      successfulCallCount: 0,
      failedCallCount: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      routesUsed: [],
    };
    existing.providerId ||= params.providerId;
    existing.modelId ||= params.modelId;
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
    if (typeof params.reasoningTokens === 'number') {
      existing.totalReasoningTokens = (existing.totalReasoningTokens ?? 0) + params.reasoningTokens;
    }
    existing.lastOccupiedTokens = params.inputTokens;
    existing.lastPromptBreakdown = params.precomputedBreakdown;
    existing.lastSnapshotAt = Date.now();
    this.runSummaries.set(key, existing);
    this.broadcastRunUsage(key);
    this.persistRunUsage(key, params.sessionId ?? existing.sessionId);
  }

  private toContextUsageSummary(key: string, summary: RunLlmExecutionSummary): RunContextUsageSummary {
    const turnControls = this.resolveSessionTurnControls(key, summary);
    const planning = planEffectiveModelRequest({
      providerId: summary.providerId,
      modelId: summary.modelId,
      settings: settingsService.getAll(),
      controls: turnControls ?? undefined,
    });
    const contextWindowTokens = planning.ok ? planning.plan.contextBudgetTokens : 0;
    const occupiedTokens = summary.lastOccupiedTokens ?? 0;
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
      ...(positiveTokenOrOmit(summary.totalReasoningTokens) !== undefined
        ? { reasoningTokens: positiveTokenOrOmit(summary.totalReasoningTokens) }
        : {}),
    };
  }

  private readPersistedUsage(key: string, fallbackSessionId?: string | null): RunContextUsageSummary | null {
    const direct = storageAdapter.readSessionUsage(key);
    if (direct) return direct;
    if (!fallbackSessionId || fallbackSessionId === key || isSubagentSessionId(fallbackSessionId)) return null;
    const viaSession = storageAdapter.readSessionUsage(fallbackSessionId);
    return viaSession?.runId === key ? viaSession : null;
  }

  private resolveSessionTurnControls(
    key: string,
    summary: RunLlmExecutionSummary,
  ): ConversationTurnControls | null {
    if (key.startsWith('sess_')) return storageAdapter.readSession(key)?.turnControls ?? null;
    return summary.sessionId ? storageAdapter.readSession(summary.sessionId)?.turnControls ?? null : null;
  }

  private persistRunUsage(key: string, sessionId: string | null | undefined): void {
    if (!sessionId || isSubagentSessionId(sessionId)) return;
    const usage = this.getRunContextUsage(key);
    if (usage) storageAdapter.writeSessionUsage(sessionId, usage);
  }

  private broadcastRunUsage(runId: string): void {
    const usage = this.getRunContextUsage(runId);
    if (usage) workflowProjectionPublisher.publishRunUsage(usage);
  }
}

export const debuggerLlmService = new DebuggerLlmService();

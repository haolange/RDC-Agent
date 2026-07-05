import type { AgentRole } from '@shared/types/agent';
import type { ActionEvent } from '@shared/types/evidence';
import type { LLMMessage, LLMRequest, LLMResponse } from '@shared/types/llm';
import type { ContextUsageBreakdownEntry, RunContextUsageSummary } from '@shared/types/session';
import type { ConversationTurnControls } from '@shared/types/modelCapability';
import { resolveActiveContextWindowTokens } from '@shared/types/modelCapability';
import type { Blocker, WorkflowStage } from '@shared/types/workflow';
import { BLOCKER_CODES } from '@shared/constants/blockers';
import type { LlmProviderProtocol, LlmProviderEntry, LlmProviderId } from '@shared/types/settings';
import { llmAdapter } from '../settings/LLMAdapter';
import { providerAccountAuthService } from '../settings/ProviderAccountAuthService';
import { settingsService } from '../settings/SettingsService';
import { resolveModelCapability } from '../settings/ModelCapabilityResolver';
import { resolveCompatibleAgentRoute } from './LlmRouteCompatibility';
import { runtimeLogService } from '../runtime/RuntimeLogService';
import { storageAdapter } from '../sessions/StorageAdapter';
import { workflowProjectionPublisher } from '../workflow/debugger/WorkflowProjectionPublisher';

export type LlmAuditStage = WorkflowStage | 'plan' | 'report';

export interface ResolvedDebuggerRoute {
  agentId: AgentRole;
  stage: LlmAuditStage;
  provider: LlmProviderEntry;
  providerId: string;
  modelId: string;
  requestedModelId?: string;
  remapReason?: string;
}

export interface LlmCallContext {
  agentId: AgentRole;
  stage: LlmAuditStage;
  sessionId?: string;
  runId?: string;
}

export interface LlmCallResult {
  route: ResolvedDebuggerRoute;
  response: LLMResponse;
  text: string;
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
  /** 最近一次主对话请求的窗口占用量（=provider 上报的 inputTokens）。 */
  lastOccupiedTokens?: number;
  /** 最近一次主对话请求的分类 token 估算（系统提示 / 工具定义 / 对话）。 */
  lastPromptBreakdown?: ContextUsageBreakdownEntry[] | null;
  /** 最近一次用量快照时间戳。 */
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

interface StructuredCallInput<T> extends LlmCallContext {
  messages: LLMMessage[];
  maxTokens?: number;
  temperature?: number;
  parse: (text: string) => T;
  auditSummary?: (data: T, text: string) => string;
  testValue?: T;
}

class DebuggerLlmBlockerError extends Error {
  readonly blocker: Blocker;

  constructor(blocker: Blocker) {
    super(blocker.reason);
    this.name = 'DebuggerLlmBlockerError';
    this.blocker = blocker;
  }
}

function makeBlocker(code: string, reason: string, refs: string[] = []): Blocker {
  return {
    code,
    reason,
    refs,
    detectedAt: new Date().toISOString(),
  };
}

function extractTextContent(content: LLMResponse['content']): string {
  if (typeof content === 'string') {
    return content.trim();
  }

  return content
    .map((block) => {
      if (block.type === 'text') {
        return block.text || '';
      }
      if (block.type === 'tool_result') {
        return block.content || '';
      }
      return '';
    })
    .join('\n')
    .trim();
}

/**
 * 将分类估算缩放到 provider 权威占用量，并在已知窗口时追加“空闲”段。
 *
 * 分类估算为字符/4 近似，缩放后各段之和≈occupiedTokens，使堆叠条与
 * 头部占用率一致；缺少数据时返回 null。
 */
function buildScaledBreakdown(
  raw: ContextUsageBreakdownEntry[] | null,
  occupiedTokens: number,
  contextWindowTokens: number | null,
): ContextUsageBreakdownEntry[] | null {
  if (!raw || raw.length === 0) {
    return null;
  }
  const estimateSum = raw.reduce((acc, entry) => acc + entry.tokens, 0);
  const scaleFactor = estimateSum > 0 && occupiedTokens > 0 ? occupiedTokens / estimateSum : 1;
  const scaled: ContextUsageBreakdownEntry[] = raw.map((entry) => ({
    id: entry.id,
    tokens: Math.max(0, Math.round(entry.tokens * scaleFactor)),
    ...(entry.count !== undefined ? { count: entry.count } : {}),
  }));
  if (contextWindowTokens) {
    scaled.push({ id: 'free', tokens: Math.max(0, contextWindowTokens - occupiedTokens) });
  }
  return scaled;
}

function extractBalancedJsonFragment(text: string, opening: '{' | '['): string | null {
  const start = text.indexOf(opening);
  if (start < 0) {
    return null;
  }

  const closing = opening === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }
      if (char === '\\') {
        escaping = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === opening) {
      depth += 1;
      continue;
    }

    if (char === closing) {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return null;
}

function extractJsonCandidate(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('LLM response was empty');
  }

  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    // continue
  }

  const fencedMatch = trimmed.match(/```json\s*([\s\S]*?)```/i) || trimmed.match(/```\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    const candidate = fencedMatch[1].trim();
    JSON.parse(candidate);
    return candidate;
  }

  const balancedObject = extractBalancedJsonFragment(trimmed, '{');
  if (balancedObject) {
    JSON.parse(balancedObject);
    return balancedObject;
  }

  const balancedArray = extractBalancedJsonFragment(trimmed, '[');
  if (balancedArray) {
    JSON.parse(balancedArray);
    return balancedArray;
  }

  const objectStart = trimmed.indexOf('{');
  const objectEnd = trimmed.lastIndexOf('}');
  if (objectStart >= 0 && objectEnd > objectStart) {
    const candidate = trimmed.slice(objectStart, objectEnd + 1);
    JSON.parse(candidate);
    return candidate;
  }

  const arrayStart = trimmed.indexOf('[');
  const arrayEnd = trimmed.lastIndexOf(']');
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    const candidate = trimmed.slice(arrayStart, arrayEnd + 1);
    JSON.parse(candidate);
    return candidate;
  }

  throw new Error('LLM response did not contain valid JSON');
}

function shouldRetryStructuredLlmError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /LLM response was empty|did not contain valid JSON|Unexpected non-whitespace character after JSON|OpenRouter API error: 5\d\d|timed out|timeout/i.test(message);
}

function readRouteProtocol(route: ResolvedDebuggerRoute): LlmProviderProtocol | null {
  return route.provider.protocol ?? null;
}

function shouldUseNativeJsonObject(route: ResolvedDebuggerRoute): boolean {
  const protocol = readRouteProtocol(route);
  const modelId = route.modelId.toLowerCase();

  if (!protocol || protocol === 'AnthropicMessages') {
    return false;
  }

  if (/moonshot|kimi/.test(modelId)) {
    return false;
  }

  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class DebuggerLlmService {
  private runSummaries = new Map<string, RunLlmExecutionSummary>();

  resetRunSummary(runId: string): void {
    this.runSummaries.delete(runId);
    this.broadcastRunUsage(runId);
  }

  getRunSummary(runId: string): RunLlmExecutionSummary | null {
    const summary = this.runSummaries.get(runId);
    if (!summary) {
      return null;
    }

    return {
      ...summary,
      routesUsed: summary.routesUsed.map((entry) => ({ ...entry })),
    };
  }

  getRunContextUsage(runId: string): RunContextUsageSummary | null {
    const summary = this.runSummaries.get(runId);
    if (!summary) {
      return null;
    }

    const settings = settingsService.getAll();
    const turnControls = this.resolveSessionTurnControls(runId, summary);
    const capability = resolveModelCapability(summary.providerId, summary.modelId, settings);
    const contextWindowTokens = resolveActiveContextWindowTokens(capability, turnControls ?? {
      reasoningLevel: capability.defaultReasoningLevel,
      maxContextMode: false,
      fastModel: false,
    });
    const totalTokens = summary.totalInputTokens + summary.totalOutputTokens;
    const occupiedTokens = summary.lastOccupiedTokens ?? 0;

    return {
      runId,
      providerId: summary.providerId,
      modelId: summary.modelId,
      inputTokens: summary.totalInputTokens,
      outputTokens: summary.totalOutputTokens,
      totalTokens,
      contextWindowTokens,
      usagePercent: Math.min(100, Math.max(0, Math.round((occupiedTokens / contextWindowTokens) * 100))),
      occupiedTokens,
      breakdown: buildScaledBreakdown(summary.lastPromptBreakdown ?? null, occupiedTokens, contextWindowTokens),
      snapshotAt: summary.lastSnapshotAt ?? null,
    };
  }

  private resolveSessionTurnControls(key: string, summary: RunLlmExecutionSummary): ConversationTurnControls | null {
    if (key.startsWith('sess_')) {
      return storageAdapter.readSession(key)?.turnControls ?? null;
    }
    if (summary.sessionId) {
      return storageAdapter.readSession(summary.sessionId)?.turnControls ?? null;
    }
    return null;
  }

  /**
   * 记录一次 agent loop turn 的真实窗口占用与分类快照，并广播给 UI。
   *
   * agent 主循环不经过 {@link call}，其用量由 provider 在 `message_end` 上报；
   * 这里把它并入同一份 runSummaries，使上下文环 / 分类查看器拿到权威数据。
   * `inputTokens` 为最近一次 prompt 的真实占用；`precomputedBreakdown` 由 Orchestrator
   * 在 message_end 处按权威占用组装好后传入，作为唯一的分段来源。
   */
  recordAgentTurnUsage(params: {
    runId?: string;
    /** Ask 模式下以 sessionId 作 store key，使 Ask 路径也能广播 usage。 */
    sessionId?: string | null;
    providerId: string;
    modelId: string;
    inputTokens: number;
    outputTokens: number;
    /** 预计算的完整分段 breakdown（由 Orchestrator 在 message_end 处组装）。 */
    precomputedBreakdown: ContextUsageBreakdownEntry[];
  }): void {
    const key = params.runId ?? params.sessionId;
    if (!key) {
      return;
    }

    const existing = this.runSummaries.get(key) ?? {
      providerId: params.providerId,
      modelId: params.modelId,
      sessionId: params.sessionId ?? null,
      successfulCallCount: 0,
      failedCallCount: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      firstRequestId: undefined,
      routesUsed: [],
    };
    existing.providerId = existing.providerId || params.providerId;
    existing.modelId = existing.modelId || params.modelId;
    if (params.sessionId) {
      existing.sessionId = params.sessionId;
    }
    existing.successfulCallCount += 1;
    existing.totalInputTokens += params.inputTokens;
    existing.totalOutputTokens += params.outputTokens;
    existing.lastOccupiedTokens = params.inputTokens;
    existing.lastPromptBreakdown = params.precomputedBreakdown;
    existing.lastSnapshotAt = Date.now();

    this.runSummaries.set(key, existing);
    this.broadcastRunUsage(key);
  }

  private async refreshAccountRuntimeCredentials(route: ResolvedDebuggerRoute): Promise<void> {
    if (route.provider.authMode !== 'account') {
      return;
    }
    await providerAccountAuthService.ensureRuntimeCredentials(route.providerId as LlmProviderId);
  }

  getRouteBlockers(
    agentIds: AgentRole[],
    stage: LlmAuditStage,
    settings = settingsService.getAll(),
  ): Blocker[] {
    const blockers: Blocker[] = [];
    const seen = new Set<string>();

    for (const agentId of agentIds) {
      try {
        this.resolveRoute(agentId, stage, settings);
      } catch (error) {
        if (!(error instanceof DebuggerLlmBlockerError)) {
          throw error;
        }
        const key = `${error.blocker.code}:${agentId}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        blockers.push(error.blocker);
      }
    }

    return blockers;
  }

  resolveRoute(
    agentId: AgentRole,
    stage: LlmAuditStage,
    settings = settingsService.getAll(),
  ): ResolvedDebuggerRoute {
    const requestedRoute = settings.llm.agentRoutes.find((entry) => entry.agentId === agentId);
    const resolution = resolveCompatibleAgentRoute(settings.llm.agentRoutes, settings.llm.providers, agentId);
    const route = resolution.route;
    if (!route?.providerId || !route.modelId) {
      throw new DebuggerLlmBlockerError(makeBlocker(
        BLOCKER_CODES.BLOCKED_LLM_ROUTE_MISSING.code,
        `${agentId} is not bound to a provider/model route.`,
        [`agent:${agentId}`],
      ));
    }

    const provider = resolution.provider ?? settings.llm.providers.find((entry) => entry.id === route.providerId);
    if (!provider || !provider.enabled) {
      throw new DebuggerLlmBlockerError(makeBlocker(
        BLOCKER_CODES.BLOCKED_LLM_PROVIDER_MISSING.code,
        `${agentId} route points to an unavailable provider: ${route.providerId}.`,
        [`agent:${agentId}`, `provider:${route.providerId}`],
      ));
    }

    const model = provider.models.find((entry) => entry.enabled && entry.id === route.modelId);
    if (!model) {
      throw new DebuggerLlmBlockerError(makeBlocker(
        BLOCKER_CODES.BLOCKED_LLM_MODEL_MISSING.code,
        `${agentId} route points to a disabled or missing model: ${route.modelId}.`,
        [`agent:${agentId}`, `provider:${provider.id}`, `model:${route.modelId}`],
      ));
    }

    const secret = provider.authMode === 'local'
      ? 'local-provider'
      : provider.authMode === 'environment'
        ? 'environment-provider'
        : provider.authMode === 'account'
          ? settingsService.getProviderOAuthSecret(provider.id, settings.workspace.rootPath)
          : settingsService.getProviderSecret(provider.id, settings.workspace.rootPath);
    if (!secret.trim()) {
      throw new DebuggerLlmBlockerError(makeBlocker(
        BLOCKER_CODES.BLOCKED_LLM_SECRET_MISSING.code,
        `${agentId} route provider is missing a usable secret: ${provider.id}.`,
        [`agent:${agentId}`, `provider:${provider.id}`],
      ));
    }

    return {
      agentId,
      stage,
      provider,
      providerId: provider.id,
      modelId: route.modelId,
      requestedModelId: resolution.requestedModelId ?? requestedRoute?.modelId,
      remapReason: resolution.remapReason,
    };
  }

  async call(context: LlmCallContext, request: Omit<LLMRequest, 'model'>): Promise<LlmCallResult> {
    const settings = settingsService.getAll();
    const route = this.resolveRoute(context.agentId, context.stage, settings);

    if (process.env.RDC_AGENT_TEST_MODE === '1') {
      const response: LLMResponse = {
        id: `test-llm-${Date.now()}`,
        model: route.modelId,
        content: '',
        usage: {
          inputTokens: 0,
          outputTokens: 0,
        },
        stopReason: 'end_turn',
      };

      const text = '';
      await this.recordCall(context, route, response, 'ok', 'test-mode llm stub');
      return {
        route,
        response,
        text,
      };
    }

    await this.refreshAccountRuntimeCredentials(route);
    llmAdapter.configure(settingsService.getLlmConfig());

    try {
      const response = await llmAdapter.chat({
        ...request,
        model: route.modelId,
      }, route.providerId);
      const text = extractTextContent(response.content);
      await this.recordCall(context, route, response, 'ok', text || `${route.providerId}/${route.modelId}`);
      return {
        route,
        response,
        text,
      };
    } catch (error) {
      await this.recordFailure(context, route, error instanceof Error ? error.message : String(error));
      throw this.toRuntimeError(route, error);
    }
  }

  async callStructured<T>(input: StructuredCallInput<T>): Promise<{ data: T; call: LlmCallResult }> {
    if (process.env.RDC_AGENT_TEST_MODE === '1' && input.testValue !== undefined) {
      const settings = settingsService.getAll();
      const route = this.resolveRoute(input.agentId, input.stage, settings);
      const response: LLMResponse = {
        id: `test-llm-${Date.now()}`,
        model: route.modelId,
        content: JSON.stringify(input.testValue),
        usage: {
          inputTokens: 0,
          outputTokens: 0,
        },
        stopReason: 'end_turn',
      };
      const text = JSON.stringify(input.testValue);
      const summary = input.auditSummary ? input.auditSummary(input.testValue, text) : text;
      await this.recordCall(input, route, response, 'ok', summary);
      return {
        data: input.testValue,
        call: {
          route,
          response,
          text,
        },
      };
    }

    const settings = settingsService.getAll();
    const route = this.resolveRoute(input.agentId, input.stage, settings);
    await this.refreshAccountRuntimeCredentials(route);
    llmAdapter.configure(settingsService.getLlmConfig());
    const useNativeJsonObject = shouldUseNativeJsonObject(route);

    let lastError: unknown;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const response = await llmAdapter.chat({
          messages: input.messages,
          model: route.modelId,
          maxTokens: input.maxTokens,
          temperature: input.temperature,
          responseFormat: useNativeJsonObject ? 'json_object' : undefined,
        }, route.providerId);
        const text = extractTextContent(response.content);
        const data = input.parse(text);
        const summary = input.auditSummary ? input.auditSummary(data, text) : text || `${route.providerId}/${route.modelId}`;
        await this.recordCall(input, route, response, 'ok', summary);
        return {
          data,
          call: {
            route,
            response,
            text,
          },
        };
      } catch (error) {
        lastError = error;
        if (attempt < 3 && shouldRetryStructuredLlmError(error)) {
          await sleep(500 * (attempt + 1));
          continue;
        }
        await this.recordFailure(
          input,
          route,
          error instanceof Error ? error.message : String(error),
        );
        throw this.toRuntimeError(route, error);
      }
    }

    await this.recordFailure(
      input,
      route,
      lastError instanceof Error ? lastError.message : String(lastError),
    );
    throw this.toRuntimeError(route, lastError);
  }

  parseJson<T>(text: string): T {
    return JSON.parse(extractJsonCandidate(text)) as T;
  }

  private toRuntimeError(route: ResolvedDebuggerRoute, error: unknown): DebuggerLlmBlockerError {
    const message = error instanceof Error ? error.message : String(error);
    const providerUnavailable = /provider not found|provider disabled|provider not configured|no llm provider configured/i.test(message);
    const code = providerUnavailable
      ? BLOCKER_CODES.BLOCKED_LLM_PROVIDER_UNAVAILABLE.code
      : BLOCKER_CODES.BLOCKED_LLM_REQUEST_FAILED.code;

    return new DebuggerLlmBlockerError(makeBlocker(
      code,
      `${route.agentId} failed to call ${route.providerId}/${route.modelId}: ${message}`,
      [`agent:${route.agentId}`, `provider:${route.providerId}`, `model:${route.modelId}`],
    ));
  }

  private async recordCall(
    context: LlmCallContext,
    route: ResolvedDebuggerRoute,
    response: LLMResponse,
    status: 'ok' | 'error',
    summary: string,
  ): Promise<void> {
    this.updateRunSummary(context, route, response, status);

    runtimeLogService.log({
      scope: context.sessionId ? 'session' : 'app',
      namespace: 'llm',
      severity: status === 'ok' ? 'success' : 'error',
      title: `${route.agentId} -> ${route.providerId}/${route.modelId}`,
      summary,
      detail: response.id ? `request=${response.id}` : undefined,
      sessionId: context.sessionId ?? null,
      runId: context.runId ?? null,
      raw: {
        agentId: route.agentId,
        stage: route.stage,
        providerId: route.providerId,
        modelId: route.modelId,
        requestedModelId: route.requestedModelId,
        remapReason: route.remapReason,
        requestId: response.id,
        usage: response.usage,
      },
    });

    if (!context.sessionId || !context.runId) {
      return;
    }

    const event = storageAdapter.createActionEvent({
      runId: context.runId,
      sessionId: context.sessionId,
      agentId: route.agentId,
      eventType: 'llm_call',
      status,
      payload: {
        agentId: route.agentId,
        stage: route.stage,
        providerId: route.providerId,
        modelId: route.modelId,
        requestedModelId: route.requestedModelId,
        remapReason: route.remapReason,
        requestId: response.id,
        usage: response.usage,
        summary,
      },
    });
    await this.appendBroadcastEvent(context.sessionId, event);
  }

  private async recordFailure(
    context: LlmCallContext,
    route: ResolvedDebuggerRoute,
    errorMessage: string,
  ): Promise<void> {
    this.updateRunSummary(context, route, null, 'error');

    runtimeLogService.log({
      scope: context.sessionId ? 'session' : 'app',
      namespace: 'llm',
      severity: 'error',
      title: `${route.agentId} -> ${route.providerId}/${route.modelId}`,
      summary: errorMessage,
      sessionId: context.sessionId ?? null,
      runId: context.runId ?? null,
      raw: {
        agentId: route.agentId,
        stage: route.stage,
        providerId: route.providerId,
        modelId: route.modelId,
        requestedModelId: route.requestedModelId,
        remapReason: route.remapReason,
      },
    });

    if (!context.sessionId || !context.runId) {
      return;
    }

    const event = storageAdapter.createActionEvent({
      runId: context.runId,
      sessionId: context.sessionId,
      agentId: route.agentId,
      eventType: 'llm_call',
      status: 'error',
      payload: {
        agentId: route.agentId,
        stage: route.stage,
        providerId: route.providerId,
        modelId: route.modelId,
        requestedModelId: route.requestedModelId,
        remapReason: route.remapReason,
        summary: errorMessage,
      },
    });
    await this.appendBroadcastEvent(context.sessionId, event);
  }

  private updateRunSummary(
    context: LlmCallContext,
    route: ResolvedDebuggerRoute,
    response: LLMResponse | null,
    status: 'ok' | 'error',
  ): void {
    if (!context.runId) {
      return;
    }

    const existing = this.runSummaries.get(context.runId) ?? {
      providerId: route.providerId,
      modelId: route.modelId,
      sessionId: context.sessionId ?? null,
      successfulCallCount: 0,
      failedCallCount: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      firstRequestId: undefined,
      routesUsed: [],
    };

    existing.providerId = existing.providerId || route.providerId;
    existing.modelId = existing.modelId || route.modelId;
    if (context.sessionId) {
      existing.sessionId = context.sessionId;
    }
    if (status === 'ok') {
      existing.successfulCallCount += 1;
      if (!existing.firstRequestId && response?.id) {
        existing.firstRequestId = response.id;
      }
      existing.totalInputTokens += response?.usage.inputTokens ?? 0;
      existing.totalOutputTokens += response?.usage.outputTokens ?? 0;
    } else {
      existing.failedCallCount += 1;
    }
    existing.routesUsed.push({
      agentId: route.agentId,
      stage: route.stage,
      providerId: route.providerId,
      modelId: route.modelId,
      requestId: response?.id,
      status,
    });
    this.runSummaries.set(context.runId, existing);
    this.broadcastRunUsage(context.runId);
  }

  private broadcastRunUsage(runId: string): void {
    const usage = this.getRunContextUsage(runId);
    if (!usage) {
      return;
    }

    workflowProjectionPublisher.publishRunUsage(usage);
  }

  private async appendBroadcastEvent(sessionId: string, event: ActionEvent): Promise<void> {
    await storageAdapter.appendActionEvent(sessionId, event);
    workflowProjectionPublisher.publishEvidenceEvent(event);
  }
}

export const debuggerLlmService = new DebuggerLlmService();

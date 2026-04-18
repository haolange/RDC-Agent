import { BrowserWindow } from 'electron';
import type { AgentRole } from '@shared/types/agent';
import type { ActionEvent } from '@shared/types/evidence';
import type { LLMMessage, LLMRequest, LLMResponse } from '@shared/types/llm';
import type { RunContextUsageSummary } from '@shared/types/session';
import type { Blocker, WorkflowStage } from '@shared/types/workflow';
import { BLOCKER_CODES } from '@shared/constants/blockers';
import type { LlmProviderEntry } from '@shared/types/settings';
import { llmAdapter } from '../adapters/LLMAdapter';
import { settingsService } from './SettingsService';
import { runtimeLogService } from './RuntimeLogService';
import { storageAdapter } from './StorageAdapter';

export type LlmAuditStage = WorkflowStage | 'plan' | 'skeptic' | 'curate' | 'report' | 'dispatch' | 'cowork';

export interface ResolvedDebuggerRoute {
  agentId: AgentRole;
  stage: LlmAuditStage;
  provider: LlmProviderEntry;
  providerId: string;
  modelId: string;
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
  successfulCallCount: number;
  failedCallCount: number;
  firstRequestId?: string;
  totalInputTokens: number;
  totalOutputTokens: number;
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

function shouldUseNativeJsonObject(route: ResolvedDebuggerRoute): boolean {
  const providerKind = route.provider.kind;
  const modelId = route.modelId.toLowerCase();

  if (providerKind === 'anthropic') {
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
    const provider = settings.llm.providers.find((entry) => entry.id === summary.providerId);
    const model = provider?.models.find((entry) => entry.id === summary.modelId) ?? null;
    const contextWindowTokens = typeof model?.contextWindowTokens === 'number' && model.contextWindowTokens > 0
      ? model.contextWindowTokens
      : null;
    const totalTokens = summary.totalInputTokens + summary.totalOutputTokens;

    return {
      runId,
      providerId: summary.providerId,
      modelId: summary.modelId,
      inputTokens: summary.totalInputTokens,
      outputTokens: summary.totalOutputTokens,
      totalTokens,
      contextWindowTokens,
      usagePercent: contextWindowTokens
        ? Math.min(100, Math.max(0, Math.round((totalTokens / contextWindowTokens) * 100)))
        : 0,
      hasConfiguredContextWindow: Boolean(contextWindowTokens),
    };
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
    const route = settings.llm.agentRoutes.find((entry) => entry.agentId === agentId);
    if (!route?.providerId || !route.modelId) {
      throw new DebuggerLlmBlockerError(makeBlocker(
        BLOCKER_CODES.BLOCKED_LLM_ROUTE_MISSING.code,
        `${agentId} is not bound to a provider/model route.`,
        [`agent:${agentId}`],
      ));
    }

    const provider = settings.llm.providers.find((entry) => entry.id === route.providerId);
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

    const secret = provider.kind === 'ollama'
      ? 'ollama-local'
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
      successfulCallCount: 0,
      failedCallCount: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      firstRequestId: undefined,
      routesUsed: [],
    };

    existing.providerId = existing.providerId || route.providerId;
    existing.modelId = existing.modelId || route.modelId;
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

    const windows = BrowserWindow.getAllWindows();
    for (const window of windows) {
      if (!window.isDestroyed()) {
        window.webContents.send('workflow:runUsageChanged', usage);
      }
    }
  }

  private async appendBroadcastEvent(sessionId: string, event: ActionEvent): Promise<void> {
    await storageAdapter.appendActionEvent(sessionId, event);
    const windows = BrowserWindow.getAllWindows();
    for (const window of windows) {
      if (!window.isDestroyed()) {
        window.webContents.send('evidence:eventAdded', event);
      }
    }
  }
}

export const debuggerLlmService = new DebuggerLlmService();

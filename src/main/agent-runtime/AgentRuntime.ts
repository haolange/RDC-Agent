import fs from 'fs';
import path from 'path';
import type { AgentRole } from '@shared/types/agent';
import type {
  AgentAssistantCompletedPayload,
  AgentEvent,
  AgentEventPayload,
  AgentEventType,
  AgentToolCompletedPayload,
  AgentToolDeniedPayload,
  AgentToolRequestedPayload,
  AgentToolStartedPayload,
} from '@shared/types/agentRuntime';
import type { LLMMessage, LLMResponse, LLMStreamEvent, ToolCall } from '@shared/types/llm';
import type { AppMode } from '@shared/types/session';
import type { ToolCallResult } from '@shared/types/tool';
import type { WorkflowPhase, WorkflowStage } from '@shared/types/workflow';
import { generateEventId, nowMs } from '@shared/utils/id';
import { appPathService } from '../runtime/AppPathService';
import { llmAdapter } from '../settings/LLMAdapter';
import { providerAccountAuthService } from '../settings/ProviderAccountAuthService';
import { settingsService } from '../settings/SettingsService';
import { toolRegistry } from './ToolRegistry';
import { isRuntimeToolAllowed, resolveRuntimeToolAllowlist } from './AgentRuntimeToolPolicy';
import { modelProviderRegistry } from './ModelProviderRegistry';

export interface AgentRuntimeAskUserRequest {
  approvalId: string;
  question: string;
  options?: string[];
  toolCallId: string;
  runId: string;
  turnId?: string;
  sessionId?: string | null;
}

export interface AgentRuntimeToolApprovalRequest {
  approvalId: string;
  toolCall: ToolCall;
  toolName: string;
  runId: string;
  turnId?: string;
  sessionId?: string | null;
}

export interface AgentRuntimeRunRequest {
  agentId: AgentRole;
  mode: AppMode;
  prompt: string;
  systemPrompt: string;
  providerId: string;
  modelId: string;
  maxTokens?: number;
  temperature?: number;
  maxTurns?: number;
  maxToolIterations?: number;
  toolAllowlist?: string[];
  patternId?: string;
  stage?: WorkflowStage | 'cowork' | 'report';
  phase?: WorkflowPhase;
  runId?: string;
  sessionId?: string | null;
  turnId?: string;
  signal?: AbortSignal;
  askUser?: (request: AgentRuntimeAskUserRequest) => Promise<{ answer?: unknown; cancelled?: boolean }>;
  approveTool?: (request: AgentRuntimeToolApprovalRequest) => Promise<{ approved: boolean; reason?: string }>;
  onStreamEvent?: (event: LLMStreamEvent) => void;
  onEvent?: (event: AgentEvent) => void;
}

export interface AgentRuntimeRunResult {
  text: string;
  response?: LLMResponse;
  toolResults: Array<{
    toolName: string;
    result: ToolCallResult;
  }>;
  events: AgentEvent[];
}

export class AgentRuntime {
  async runTurn(request: AgentRuntimeRunRequest): Promise<AgentRuntimeRunResult> {
    const events: AgentEvent[] = [];
    const toolResults: AgentRuntimeRunResult['toolResults'] = [];
    const runId = request.runId || generateEventId('agent-run');
    const allowlist = resolveRuntimeToolAllowlist(request.agentId, request.toolAllowlist);
    let streamedText = '';
    let finalResponse: LLMResponse | undefined;

    const emit = (type: AgentEventType, payload: AgentEventPayload): AgentEvent => {
      const event: AgentEvent = {
        id: generateEventId('agent-event'),
        type,
        timestamp: nowMs(),
        runId,
        turnId: request.turnId,
        sessionId: request.sessionId ?? null,
        agentId: request.agentId,
        stage: request.stage,
        phase: request.phase,
        payload,
      };
      events.push(event);
      request.onEvent?.(event);
      this.persistEvent(event);
      return event;
    };

    emit('run.started', {
      mode: request.mode,
      patternId: request.patternId,
      providerId: request.providerId,
      modelId: request.modelId,
      toolAllowlist: allowlist,
    });

    const testStub = this.createTestModeStub(request);
    if (testStub) {
      for (const chunk of splitForStreaming(testStub)) {
        streamedText += chunk;
        emit('assistant.delta', { text: chunk });
        await Promise.resolve();
      }
      emit('assistant.completed', { text: streamedText });
      emit('run.completed', { status: 'complete', text: streamedText });
      return { text: streamedText, toolResults, events };
    }

    try {
      if (!request.providerId || !request.modelId) {
        const message = 'No provider/model route is configured for this agent.';
        emit('diagnostic', {
          code: 'AGENT_RUNTIME_ROUTE_MISSING',
          severity: 'error',
          message,
        });
        emit('run.failed', { status: 'failed', error: message });
        throw new Error(message);
      }

      await this.refreshAccountRuntimeCredentials(request.providerId);
      const { tools, nameMap } = await toolRegistry.listAllowedLlmTools(request.agentId, allowlist);
      const traceReasoningContract = [
        'Trace output contract:',
        'When surfacing user-visible reasoning, emit JSON VisibleReasoningPacket objects instead of raw tool dumps.',
        'Schema: {"mode":"planning|executing|reflecting","content":"...","hypothesis":"...","nextAction":"...","confidence":"low|medium|high"}',
        'Keep final answers in markdown; keep raw tool payloads out of the main narrative.',
      ].join('\n');
      const messages: LLMMessage[] = [
        { role: 'system', content: `${request.systemPrompt}\n\n${traceReasoningContract}` },
        { role: 'user', content: request.prompt },
      ];
      const maxToolIterations = clampPositiveInt(request.maxToolIterations ?? request.maxTurns ?? 8, 1, 32);
      let toolIteration = 0;

      for (;;) {
        let turnText = '';
        finalResponse = await modelProviderRegistry.streamTurn({
          providerId: request.providerId,
          modelId: request.modelId,
          request: {
            messages,
            model: request.modelId,
            maxTokens: request.maxTokens,
            temperature: request.temperature,
            tools,
            signal: request.signal,
          },
          onStreamEvent: (event) => {
            request.onStreamEvent?.(event);
            if (event.type === 'text-delta') {
              streamedText += event.text;
              turnText += event.text;
              emit('assistant.delta', { text: event.text });
            }
            if (event.type === 'tool-call-delta') {
              const toolCall: ToolCall = {
                id: event.toolCall.id,
                name: nameMap.get(event.toolCall.name ?? '') ?? event.toolCall.name ?? '',
                arguments: event.toolCall.argumentsText ? { raw: event.toolCall.argumentsText } : {},
              };
              emit('tool.requested', { toolCall, streamEvent: event } as AgentToolRequestedPayload);
            }
          },
        });

        if (!turnText && typeof finalResponse.content === 'string' && finalResponse.content) {
          turnText = finalResponse.content;
          streamedText = [streamedText, turnText].filter(Boolean).join(streamedText ? '\n' : '');
        }

        const toolCalls = finalResponse.toolCalls ?? [];
        if (toolCalls.length === 0) {
          break;
        }
        if (toolIteration >= maxToolIterations) {
          emit('diagnostic', {
            code: 'AGENT_RUNTIME_MAX_TOOL_ITERATIONS',
            severity: 'warning',
            message: `Stopped tool loop after ${maxToolIterations} iterations.`,
          });
          break;
        }

        messages.push({
          role: 'assistant',
          content: turnText || 'I requested tool results.',
        });

        const toolSummary = await this.executeToolCalls({
          request,
          runId,
          allowlist,
          nameMap,
          toolCalls,
          emit,
        });
        toolResults.push(...toolSummary.toolResults);
        messages.push({
          role: 'user',
          content: `Tool observations:\n${toolSummary.summaryPrompt}\n\nContinue the same agent turn. Do not expose raw chain-of-thought.`,
        });
        toolIteration += 1;
      }

      emit('assistant.completed', {
        text: streamedText,
        usage: finalResponse.usage,
      } as AgentAssistantCompletedPayload);
      emit('run.completed', {
        status: 'complete',
        text: streamedText,
        usage: finalResponse.usage,
      });
      return {
        text: streamedText,
        response: finalResponse,
        toolResults,
        events,
      };
    } catch (error) {
      if (request.signal?.aborted) {
        emit('run.cancelled', { status: 'cancelled', error: 'Request was cancelled.' });
        return { text: streamedText, response: finalResponse, toolResults, events };
      }
      const message = error instanceof Error ? error.message : String(error);
      if (!events.some((event) => event.type === 'run.failed')) {
        emit('diagnostic', {
          code: 'AGENT_RUNTIME_REQUEST_FAILED',
          severity: 'error',
          message: 'Agent runtime request failed.',
          technicalMessage: message,
        });
        emit('run.failed', { status: 'failed', error: message });
      }
      throw error;
    }
  }

  private async executeToolCalls(input: {
    request: AgentRuntimeRunRequest;
    runId: string;
    allowlist: string[];
    nameMap: Map<string, string>;
    toolCalls: ToolCall[];
    emit: (type: AgentEventType, payload: AgentEventPayload) => AgentEvent;
  }): Promise<{
    toolResults: Array<{ toolName: string; result: ToolCallResult }>;
    summaryPrompt: string;
  }> {
    const toolResults: Array<{ toolName: string; result: ToolCallResult }> = [];
    const summaries: string[] = [];
    for (const toolCall of input.toolCalls) {
      const originalToolName = input.nameMap.get(toolCall.name) ?? toolCall.name;
      input.emit('tool.requested', {
        toolCall: {
          ...toolCall,
          name: originalToolName,
        },
      } as AgentToolRequestedPayload);
      if (!isRuntimeToolAllowed(originalToolName, input.request.agentId, input.allowlist)) {
        const result = createToolErrorResult(
          'AGENT_RUNTIME_TOOL_DENIED',
          `Tool ${originalToolName} is not allowed for ${input.request.agentId}.`,
          'policy',
        );
        toolResults.push({ toolName: originalToolName, result });
        input.emit('tool.denied', {
          toolCallId: toolCall.id,
          toolName: originalToolName,
          reason: result.error?.message ?? 'Tool denied by runtime policy.',
          result,
        } as AgentToolDeniedPayload);
        summaries.push(formatToolObservation(originalToolName, result));
        continue;
      }
      if (isMalformedToolArguments(toolCall.arguments)) {
        const result = createToolErrorResult(
          'AGENT_RUNTIME_TOOL_ARGS_MALFORMED',
          `Tool ${originalToolName} arguments were not valid JSON object arguments.`,
          'schema',
        );
        toolResults.push({ toolName: originalToolName, result });
        input.emit('tool.denied', {
          toolCallId: toolCall.id,
          toolName: originalToolName,
          reason: result.error?.message ?? 'Malformed tool arguments.',
          result,
        } as AgentToolDeniedPayload);
        summaries.push(formatToolObservation(originalToolName, result));
        continue;
      }
      if (requiresExplicitToolApproval(originalToolName)) {
        const approvalResult = await this.requireToolApproval(input, toolCall, originalToolName);
        if (approvalResult) {
          toolResults.push({ toolName: originalToolName, result: approvalResult });
          input.emit('tool.denied', {
            toolCallId: toolCall.id,
            toolName: originalToolName,
            reason: approvalResult.error?.message ?? 'Tool approval was rejected.',
            result: approvalResult,
          } as AgentToolDeniedPayload);
          summaries.push(formatToolObservation(originalToolName, approvalResult));
          continue;
        }
      }
      if (originalToolName === 'primitive.askUser') {
        const result = await this.handleAskUserTool(input, toolCall, originalToolName);
        toolResults.push({ toolName: originalToolName, result });
        input.emit('tool.completed', {
          toolCallId: toolCall.id,
          toolName: originalToolName,
          result,
        } as AgentToolCompletedPayload);
        summaries.push(formatToolObservation(originalToolName, result));
        continue;
      }
      input.emit('tool.started', {
        toolCallId: toolCall.id,
        toolName: originalToolName,
        args: toolCall.arguments,
      } as AgentToolStartedPayload);
      const result = await toolRegistry.execute({
        agentId: input.request.agentId,
        toolCall,
        originalToolName,
        allowlist: input.allowlist,
        sessionId: input.request.sessionId,
        turnId: input.request.turnId,
        runId: input.runId,
        signal: input.request.signal,
      });
      toolResults.push({ toolName: originalToolName, result });
      input.emit('tool.completed', {
        toolCallId: toolCall.id,
        toolName: originalToolName,
        result,
      } as AgentToolCompletedPayload);
      if (!result.ok && result.error?.code === 'AGENT_RUNTIME_TOOL_DENIED') {
        input.emit('tool.denied', {
          toolCallId: toolCall.id,
          toolName: originalToolName,
          reason: result.error.message,
          result,
        } as AgentToolDeniedPayload);
      }
      summaries.push(formatToolObservation(originalToolName, result));
    }
    return {
      toolResults,
      summaryPrompt: summaries.join('\n'),
    };
  }

  private async handleAskUserTool(
    input: {
      request: AgentRuntimeRunRequest;
      runId: string;
      emit: (type: AgentEventType, payload: AgentEventPayload) => AgentEvent;
    },
    toolCall: ToolCall,
    originalToolName: string,
  ): Promise<ToolCallResult> {
    const approvalId = generateEventId('ask-user');
    const question = String(toolCall.arguments.question ?? '').trim() || 'The agent needs clarification.';
    const options = Array.isArray(toolCall.arguments.options)
      ? toolCall.arguments.options.filter((option): option is string => typeof option === 'string')
      : undefined;

    input.emit('approval.requested', {
      approvalId,
      title: 'Ask user',
      status: 'pending',
      kind: 'ask_user',
      toolCallId: toolCall.id,
      toolName: originalToolName,
      question,
      options,
    });

    if (!input.request.askUser) {
      return createToolErrorResult(
        'ASK_USER_RESUME_HANDLER_MISSING',
        'Ask-user request was emitted, but no runtime resume handler is attached for this turn.',
        'approval',
      );
    }

    const answer = await input.request.askUser({
      approvalId,
      question,
      options,
      toolCallId: toolCall.id,
      runId: input.runId,
      turnId: input.request.turnId,
      sessionId: input.request.sessionId,
    });
    input.emit('approval.answered', {
      approvalId,
      title: 'Ask user',
      status: answer.cancelled ? 'cancelled' : 'approved',
      kind: 'ask_user',
      toolCallId: toolCall.id,
      toolName: originalToolName,
      question,
      options,
      answer: answer.answer,
    });

    if (answer.cancelled) {
      return createToolErrorResult('ASK_USER_CANCELLED', 'Ask-user request was cancelled.', 'approval');
    }
    return {
      ok: true,
      data: {
        question,
        answer: answer.answer,
      },
      artifacts: [],
      duration_ms: 0,
      trace_id: generateEventId('tool'),
    };
  }

  private async requireToolApproval(
    input: {
      request: AgentRuntimeRunRequest;
      runId: string;
      emit: (type: AgentEventType, payload: AgentEventPayload) => AgentEvent;
    },
    toolCall: ToolCall,
    originalToolName: string,
  ): Promise<ToolCallResult | null> {
    const approvalId = generateEventId('tool-approval');
    input.emit('approval.requested', {
      approvalId,
      title: `Approve ${originalToolName}`,
      status: 'pending',
      kind: 'tool',
      toolCallId: toolCall.id,
      toolName: originalToolName,
      reason: 'Mutation primitive tools require explicit runtime approval.',
    });

    if (!input.request.approveTool) {
      return createToolErrorResult(
        'TOOL_APPROVAL_HANDLER_MISSING',
        `Tool ${originalToolName} requires explicit approval, but no approval handler is attached for this turn.`,
        'approval',
      );
    }

    const answer = await input.request.approveTool({
      approvalId,
      toolCall,
      toolName: originalToolName,
      runId: input.runId,
      turnId: input.request.turnId,
      sessionId: input.request.sessionId,
    });
    input.emit('approval.answered', {
      approvalId,
      title: `Approve ${originalToolName}`,
      status: answer.approved ? 'approved' : 'rejected',
      kind: 'tool',
      toolCallId: toolCall.id,
      toolName: originalToolName,
      reason: answer.reason,
    });

    return answer.approved
      ? null
      : createToolErrorResult(
        'TOOL_APPROVAL_REJECTED',
        answer.reason || `Tool ${originalToolName} was rejected by runtime approval policy.`,
        'approval',
      );
  }

  private async refreshAccountRuntimeCredentials(providerId: string): Promise<void> {
    const provider = settingsService.getAll().llm.providers.find((entry) => entry.id === providerId);
    if (provider?.authMode !== 'account') {
      return;
    }
    await providerAccountAuthService.ensureRuntimeCredentials(providerId);
    llmAdapter.configure(settingsService.getLlmConfig());
  }

  private persistEvent(event: AgentEvent): void {
    try {
      const paths = appPathService.getWorkspacePaths();
      const eventDir = path.join(paths.logsPath, 'agent-events');
      fs.mkdirSync(eventDir, { recursive: true });
      const filePath = path.join(eventDir, `${event.runId ?? 'run'}.jsonl`);
      fs.appendFileSync(filePath, `${JSON.stringify(event)}\n`, 'utf8');
    } catch (error) {
      console.warn('[AgentRuntime] Failed to persist event:', error);
    }
  }

  private createTestModeStub(request: AgentRuntimeRunRequest): string | null {
    if (process.env.RDC_AGENT_TEST_MODE !== '1') {
      return null;
    }
    let userMessage = request.prompt;
    try {
      const parsed = JSON.parse(request.prompt) as { effective_user_message?: string; user_message?: string };
      userMessage = parsed.effective_user_message || parsed.user_message || request.prompt;
    } catch {
      userMessage = request.prompt;
    }
    if (userMessage.includes('__RDC_AGENT_E2E_FORCE_COWORK_LLM_FAILURE__')) {
      throw new Error('E2E forced cowork LLM request failure');
    }
    const lower = userMessage.toLowerCase();
    let stub = request.agentId === 'ask_agent'
      ? 'Ask is ready. Describe the issue, goal, or .rdc capture you want to inspect; I will clarify without starting execution.'
      : 'Debugger is ready. Describe the symptom and capture context; I will prepare a plan before execution.';
    if (/ue4|unreal/i.test(userMessage)) {
      stub = 'UE4 is Unreal Engine 4, commonly involved in graphics debugging around materials, post-processing, shaders, and render passes.';
    } else if (/hello|hi/i.test(userMessage)) {
      stub = request.agentId === 'ask_agent'
        ? 'Hello. I can clarify the issue, explain capability boundaries, or guide you to open a .rdc capture without starting RenderDoc execution.'
        : 'Hello. In Debugger mode I will generate an execution plan first, then wait for approval before running the strict workflow.';
    } else if (/start|execute|debug|analy[sz]e/.test(lower)) {
      stub = 'Received. I will prepare the formal debugging plan first, then move into the strict execution flow only when conditions are met.';
    }
    const intent = /start|execute|debug|analy[sz]e/.test(lower) ? 'execute' : 'talk';
    return `${stub}\n<control>{"intent":"${intent}","safe_to_start":${intent === 'execute' ? 'true' : 'false'}}</control>`;
  }
}

function clampPositiveInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function isMalformedToolArguments(args: Record<string, unknown>): boolean {
  return typeof args.raw === 'string' && args.raw.trim().length > 0;
}

function requiresExplicitToolApproval(toolName: string): boolean {
  return toolName === 'primitive.bash'
    || toolName === 'primitive.write'
    || toolName === 'primitive.edit'
    || toolName === 'primitive.remove';
}

function createToolErrorResult(code: string, message: string, category: string): ToolCallResult {
  return {
    ok: false,
    data: {},
    artifacts: [],
    error: {
      code,
      message,
      category,
    },
    duration_ms: 0,
    trace_id: generateEventId('tool'),
  };
}

function formatToolObservation(toolName: string, result: ToolCallResult): string {
  return `${toolName}: ${redactSecrets(JSON.stringify(result)).slice(0, 4000)}`;
}

function redactSecrets(text: string): string {
  return text
    .replace(/(sk-[A-Za-z0-9_-]{12,})/g, '[REDACTED_SECRET]')
    .replace(/(sk-ant-[A-Za-z0-9_-]{12,})/g, '[REDACTED_SECRET]')
    .replace(/(gh[pousr]_[A-Za-z0-9_]{12,})/g, '[REDACTED_SECRET]')
    .replace(/(Bearer\s+)[A-Za-z0-9._-]{12,}/gi, '$1[REDACTED_SECRET]')
    .replace(/("(?:apiKey|accessToken|refreshToken|copilotToken|idToken|secret)"\s*:\s*")([^"]+)(")/gi, '$1[REDACTED_SECRET]$3');
}

function splitForStreaming(text: string): string[] {
  const midpoint = Math.max(1, Math.ceil(text.length / 2));
  return [text.slice(0, midpoint), text.slice(midpoint)].filter(Boolean);
}

export const agentRuntime = new AgentRuntime();

import fs from 'fs';
import path from 'path';
import type { AgentRole } from '@shared/types/agent';
import type {
  AgentAssistantCompletedPayload,
  AgentEvent,
  AgentEventPayload,
  AgentEventType,
  AgentToolCompletedPayload,
  AgentToolRequestedPayload,
  AgentToolStartedPayload,
} from '@shared/types/agentRuntime';
import type { LLMMessage, LLMResponse, ToolCall } from '@shared/types/llm';
import type { AppMode } from '@shared/types/session';
import type { ToolCallResult } from '@shared/types/tool';
import type { WorkflowPhase, WorkflowStage } from '@shared/types/workflow';
import { generateEventId, nowMs } from '@shared/utils/id';
import { appPathService } from '../runtime/AppPathService';
import { llmAdapter } from '../settings/LLMAdapter';
import { providerAccountAuthService } from '../settings/ProviderAccountAuthService';
import { settingsService } from '../settings/SettingsService';
import { toolRegistry } from './ToolRegistry';
import { resolveRuntimeToolAllowlist } from './AgentRuntimeToolPolicy';

export interface AgentRuntimeRunRequest {
  agentId: AgentRole;
  mode: AppMode;
  prompt: string;
  systemPrompt: string;
  providerId: string;
  modelId: string;
  maxTokens?: number;
  temperature?: number;
  toolAllowlist?: string[];
  patternId?: string;
  stage?: WorkflowStage | 'cowork' | 'report';
  phase?: WorkflowPhase;
  runId?: string;
  sessionId?: string | null;
  turnId?: string;
  signal?: AbortSignal;
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
      const messages: LLMMessage[] = [
        { role: 'system', content: request.systemPrompt },
        { role: 'user', content: request.prompt },
      ];

      finalResponse = await llmAdapter.streamChat(
        {
          messages,
          model: request.modelId,
          maxTokens: request.maxTokens,
          temperature: request.temperature,
          tools,
          signal: request.signal,
        },
        (event) => {
          if (event.type === 'text-delta') {
            streamedText += event.text;
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
        request.providerId,
      );

      if (!streamedText && typeof finalResponse.content === 'string') {
        streamedText = finalResponse.content;
      }

      if (finalResponse.toolCalls?.length) {
        const toolSummary = await this.executeToolCalls({
          request,
          allowlist,
          nameMap,
          toolCalls: finalResponse.toolCalls,
          emit,
        });
        toolResults.push(...toolSummary.toolResults);
        if (toolSummary.summaryPrompt) {
          const followUpText = await this.summarizeToolResults(request, messages, streamedText, toolSummary.summaryPrompt, emit);
          streamedText = [streamedText, followUpText].filter(Boolean).join('\n');
        }
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
        runId: input.request.runId,
        signal: input.request.signal,
      });
      toolResults.push({ toolName: originalToolName, result });
      input.emit('tool.completed', {
        toolCallId: toolCall.id,
        toolName: originalToolName,
        result,
      } as AgentToolCompletedPayload);
      summaries.push(`${originalToolName}: ${JSON.stringify(result).slice(0, 4000)}`);
    }
    return {
      toolResults,
      summaryPrompt: summaries.join('\n'),
    };
  }

  private async summarizeToolResults(
    request: AgentRuntimeRunRequest,
    messages: LLMMessage[],
    previousText: string,
    summaryPrompt: string,
    emit: (type: AgentEventType, payload: AgentEventPayload) => AgentEvent,
  ): Promise<string> {
    let text = '';
    const response = await llmAdapter.streamChat(
      {
        messages: [
          ...messages,
          {
            role: 'assistant',
            content: previousText || 'I requested tool results.',
          },
          {
            role: 'user',
            content: `Tool results:\n${summaryPrompt}\n\nUse these results to continue. Do not expose raw chain-of-thought.`,
          },
        ],
        model: request.modelId,
        maxTokens: request.maxTokens,
        temperature: request.temperature,
        signal: request.signal,
      },
      (event) => {
        if (event.type === 'text-delta') {
          text += event.text;
          emit('assistant.delta', { text: event.text });
        }
      },
      request.providerId,
    );
    if (!text && typeof response.content === 'string') {
      text = response.content;
    }
    return text;
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

function splitForStreaming(text: string): string[] {
  const midpoint = Math.max(1, Math.ceil(text.length / 2));
  return [text.slice(0, midpoint), text.slice(midpoint)].filter(Boolean);
}

export const agentRuntime = new AgentRuntime();

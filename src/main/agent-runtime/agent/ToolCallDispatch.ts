/**
 * ToolCallDispatch — runs the tool calls of one assistant message through the executor: only
 * consecutive concurrency-safe groups run in parallel, and every call emits start/update/end events.
 */

import { executeConcurrentToolGroups } from './ConcurrentToolScheduler';
import type { ToolExecutor } from './AgentLoop';
import type { EventStream } from '../core/EventStream';
import type { AgentEvent, AssistantMessage, Message, ToolCall, ToolResultMessage } from '../core/types';
import type { RuntimePermissionState } from '@shared/types/runtimePermission';

/** 内层循环工具执行结果。 */
export interface ExecuteToolCallsResult {
  results: ToolResultMessage[];
}

function createToolCallFailure(
  toolCall: ToolCall,
  text: string,
  details?: Record<string, unknown>,
): ToolResultMessage {
  return {
    role: 'toolResult',
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    content: [{ type: 'text', text }],
    isError: true,
    ...(details ? { details } : {}),
    timestamp: Date.now(),
  };
}

/**
 * 执行助手消息中的工具调用。
 * 只并发连续 isConcurrencySafe 组；缺省与 unsafe 一律串行。
 * maxToolConcurrency 不再决定分组，仅保留配置位。
 */
export async function executeToolCalls(
  assistantMessage: AssistantMessage,
  toolExecutor: ToolExecutor | undefined,
  stream: EventStream<AgentEvent, Message[]>,
  _maxConcurrency?: number,
): Promise<ExecuteToolCallsResult> {
  const toolCalls = assistantMessage.content.filter(
    (c): c is ToolCall => c.type === 'toolCall',
  );

  const executeOne = async (toolCall: ToolCall, index: number): Promise<ToolResultMessage> => {
    void index;
    let startTime: number | undefined;
    const onExecutionStart = (permissionState?: RuntimePermissionState) => {
      if (startTime !== undefined) return;
      startTime = Date.now();
      stream.push({ type: 'tool_execution_start', toolCallId: toolCall.id, toolName: toolCall.name, args: toolCall.arguments, permissionState });
    };

    let result: ToolResultMessage;
    if (toolExecutor) {
      try {
        result = await toolExecutor.execute(
          toolCall,
          stream.signal,
          (partial) => {
            stream.push({
              type: 'tool_execution_update',
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              partialResult: partial,
            });
          },
          onExecutionStart,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        result = createToolCallFailure(toolCall, `Error: ${message}`);
      }
    } else {
      result = createToolCallFailure(
        toolCall,
        `Tool "${toolCall.name}" not available (no executor configured)`,
      );
    }

    stream.push({
      type: 'tool_execution_end',
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      result,
      durationMs: startTime === undefined ? 0 : Date.now() - startTime,
    });
    return result;
  };

  const results = await executeConcurrentToolGroups({
    calls: toolCalls,
    isSafe: (toolCall) => toolExecutor?.isConcurrencySafe?.(toolCall) === true,
    reserve: (group) => toolExecutor?.reserveDispatchBudget?.([...group]) ?? { ok: true },
    executeOne,
    createBudgetFailure: (toolCall, _index, limit) => createToolCallFailure(
      toolCall,
      `POLICY_LIMIT_EXCEEDED: ${limit}; tool execution was not started.`,
      { code: 'POLICY_LIMIT_EXCEEDED', limit },
    ),
    createNotStarted: (toolCall, _index, reason) => createToolCallFailure(
      toolCall,
      `TOOL_GROUP_NOT_STARTED: ${reason}`,
      { code: 'TOOL_GROUP_NOT_STARTED', reason },
    ),
    isErrorResult: (result) => result.isError === true,
    shouldStopAfterResult: (result) => toolExecutor?.shouldEndTurnAfterToolResult?.(result) === true,
    signal: stream.signal,
  });

  return { results };
}

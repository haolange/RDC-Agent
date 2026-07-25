/**
 * RDC_AGENT_TEST_MODE stubs for AgentOrchestrator send paths.
 */

import type { AgentRole } from '@shared/types/agent';
import type { AgentEvent as SharedAgentEvent } from '@shared/types/agentRuntime';
import { generateEventId, nowMs } from '@shared/utils/id';
import type { AgentProfileTurnOptions, AgentTurnOptions } from './orchestratorTypes';

export async function streamTestModeStub(
  stub: string,
  options?: AgentTurnOptions,
): Promise<string> {
  const midpoint = Math.max(1, Math.ceil(stub.length / 2));
  const firstChunk = stub.slice(0, midpoint);
  const secondChunk = stub.slice(midpoint);
  if (firstChunk) {
    options?.onChunk?.(firstChunk);
    await Promise.resolve();
  }
  if (secondChunk) {
    options?.onChunk?.(secondChunk);
    await Promise.resolve();
  }
  return stub;
}

export function createTestModeStub(
  agentId: AgentRole,
  content: string,
  displayName: string,
): string | null {
  if (process.env.RDC_AGENT_TEST_MODE !== '1') {
    return null;
  }
  let userMessage = content;
  try {
    const parsed = JSON.parse(content) as { effective_user_message?: string; user_message?: string };
    userMessage = parsed.effective_user_message || parsed.user_message || content;
  } catch {
    userMessage = content;
  }
  if (userMessage.includes('__RDC_AGENT_E2E_FORCE_LLM_FAILURE__')) {
    throw new Error('E2E forced profile LLM request failure');
  }
  const lower = userMessage.toLowerCase();
  let stub = agentId === 'ask'
    ? 'Ask is ready. I can inspect readonly context, search files or public pages, and explain next steps without starting a Debugger run.'
    : `${displayName} is ready. Describe the goal and I can use the configured tools for this turn.`;
  if (/ue4|unreal/i.test(userMessage)) {
    stub = 'UE4 is Unreal Engine 4, commonly involved in graphics debugging around materials, post-processing, shaders, and render passes.';
  } else if (/hello|hi/i.test(userMessage)) {
    stub = agentId === 'ask'
      ? 'Hello. I can clarify the issue, explain capability boundaries, or guide you to open a .rdc capture without starting RenderDoc execution.'
      : 'Hello. I can run as a general executable agent using the tools enabled by this agent profile.';
  } else if (/start|execute|debug|analy[sz]e/.test(lower)) {
    stub = 'Received. I will handle this as a normal agent turn using the configured tools and runtime context.';
  }
  return stub;
}

function emitProfileTestEvent(
  type: SharedAgentEvent['type'],
  payload: SharedAgentEvent['payload'],
  options?: AgentProfileTurnOptions,
): void {
  options?.onEvent?.({
    id: generateEventId('agent-event'),
    type,
    timestamp: nowMs(),
    turnId: options.turnId,
    sessionId: options.sessionId ?? null,
    stage: options.stage,
    payload,
  });
}

export async function createProfileTestResponse(
  agentId: AgentRole,
  content: string,
  options?: AgentProfileTurnOptions,
): Promise<string> {
  let userMessage = content;
  try {
    const parsed = JSON.parse(content) as { effective_user_message?: string; user_message?: string };
    userMessage = parsed.effective_user_message || parsed.user_message || content;
  } catch {
    userMessage = content;
  }
  if (userMessage.includes('__RDC_AGENT_E2E_FORCE_LLM_FAILURE__')) {
    throw new Error('E2E forced profile LLM request failure');
  }
  const lower = userMessage.toLowerCase();
  let stub = agentId === 'ask'
    ? 'I can inspect readonly context, search files or public pages, explain boundaries, or guide you to open a .rdc capture without starting a Debugger run.'
    : 'I can help scope the target and execute configured tools directly within this agent turn.';
  if (/ue4|unreal/i.test(userMessage)) {
    stub = 'UE4 is Unreal Engine 4. In RDC-Agent it is usually relevant to render pass, material, post-process, and shader debugging context.';
  } else if (/hello|hi|你好|您好/i.test(userMessage)) {
    stub = agentId === 'ask'
      ? 'Hello. I can clarify the issue, explain capability boundaries, or guide you to open a .rdc capture without starting RenderDoc execution.'
      : 'Hello. I can run as a general executable agent using the tools enabled by this agent profile.';
  } else if (/start|execute|debug|analy[sz]e/.test(lower)) {
    stub = 'Received. I will handle this as a normal agent turn using the configured tools and runtime context.';
  }
  if (agentId === 'ask' && userMessage.includes('__RDC_AGENT_E2E_ASK_READONLY_TOOL__')) {
    const toolCallId = generateEventId('e2e-tool');
    emitProfileTestEvent('tool.started', {
      toolCallId,
      toolName: 'grep',
      args: { pattern: 'ConversationService', path: 'src/main/conversation' },
    }, options);
    emitProfileTestEvent('tool.completed', {
      toolCallId,
      toolName: 'grep',
      result: {
        ok: true,
        data: {
          content: [
            {
              type: 'text',
              text: 'src/main/conversation/ConversationService.ts: Ask readonly trace is visible.',
            },
          ],
        },
        artifacts: [],
        duration_ms: 1,
        trace_id: toolCallId,
      },
    }, options);
    stub = 'I searched the workspace with grep and found the Ask conversation code path. No Debugger run was created.';
  } else if (agentId === 'ask' && userMessage.includes('__RDC_AGENT_E2E_ASK_DENY_WRITE__')) {
    const toolCallId = generateEventId('e2e-tool');
    emitProfileTestEvent('tool.started', {
      toolCallId,
      toolName: 'write_file',
      args: { path: 'should-not-exist.txt' },
    }, options);
    emitProfileTestEvent('tool.denied', {
      toolCallId,
      toolName: 'write_file',
      reason: 'Policy denied: ask can only use readonly tools.',
      result: {
        ok: false,
        data: {},
        artifacts: [],
        error: {
          code: 'AGENT_TOOL_POLICY_DENIED',
          message: 'Policy denied: ask can only use readonly tools.',
          category: 'policy',
        },
        duration_ms: 1,
        trace_id: toolCallId,
      },
    }, options);
    stub = 'I cannot write files in Ask mode. Ask can inspect and search, but mutation requires the appropriate execution flow.';
  }

  const finalStub = stub;
  if (options?.onChunk) {
    const midpoint = Math.max(1, Math.ceil(finalStub.length / 2));
    options.onChunk(finalStub.slice(0, midpoint));
    await Promise.resolve();
    options.onChunk(finalStub.slice(midpoint));
  }
  return finalStub;
}

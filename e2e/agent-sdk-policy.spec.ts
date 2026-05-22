import { expect, test } from '@playwright/test';
import {
  buildAgentRunTrace,
  createToolPolicyDeniedResult,
  formatToolResult,
  prepareAgentTools,
  summarizeSdkMessages,
} from '../src/main/workflow/debugger/AgentToolPolicy';
import type { ToolDefinition } from '../src/shared/types/tool';

const sessionTool: ToolDefinition = {
  name: 'rd.session.get_context',
  namespace: 'session',
  group: 'session',
  description: 'Return the current RDC session context.',
  parameters: [],
  returns: {
    type: 'object',
    description: 'Session context.',
  },
};

test('SDK tool policy stays fail-closed and trace-safe', () => {
  expect(prepareAgentTools([sessionTool], [])).toHaveLength(0);

  const preparedTools = prepareAgentTools([sessionTool], ['rd.session.*']);
  expect(preparedTools).toHaveLength(1);
  expect(preparedTools[0]).toMatchObject({
    originalName: 'rd.session.get_context',
    sdkName: 'rd_session_get_context',
  });

  const denied = createToolPolicyDeniedResult('rd.shader.edit_and_replace', 'not allowed');
  expect(denied.ok).toBe(false);
  expect(denied.error?.code).toBe('TOOL_DENIED_BY_RDC_POLICY');

  const formatted = formatToolResult({
    ok: true,
    data: {
      token: 'sk-testsecret1234567890',
      value: 'visible',
    },
    artifacts: [],
    duration_ms: 12,
    trace_id: 'tool-trace-1',
  });
  expect(formatted).toContain('[REDACTED_SECRET]');
  expect(formatted).not.toContain('sk-testsecret1234567890');

  const trace = buildAgentRunTrace({
    adapter: 'openai-agents-sdk',
    request: {
      agentId: 'rdc-debugger',
      prompt: 'prompt that must not enter trace',
      systemPrompt: 'system prompt that must not enter trace',
      modelId: 'v4-flash',
      providerId: 'deepseek-openai-compatible',
      toolAllowlist: ['rd.session.*'],
      stage: 'cowork',
    },
    providerKind: 'openai-compatible',
    preparedTools,
    guardrails: [{
      name: 'redaction-check',
      token: 'sk-anothersecret1234567890',
    }],
    sdkTrace: {
      messages: summarizeSdkMessages([{
        type: 'assistant',
        result: 'RDC_AGENT_LIVE_SMOKE_OK',
        message: { content: 'raw content must not be copied' },
      }]),
    },
  });
  const serializedTrace = JSON.stringify(trace);
  expect(serializedTrace).not.toContain('prompt that must not enter trace');
  expect(serializedTrace).not.toContain('system prompt that must not enter trace');
  expect(serializedTrace).not.toContain('sk-anothersecret1234567890');
  expect(serializedTrace).not.toContain('raw content must not be copied');
  expect(trace).toMatchObject({
    adapter: 'openai-agents-sdk',
    providerId: 'deepseek-openai-compatible',
    modelId: 'v4-flash',
    policy: {
      failClosed: true,
      executionLayer: 'ToolBridge',
    },
  });
});

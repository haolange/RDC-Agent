import fs from 'fs';
import path from 'path';
import { expect, test } from '@playwright/test';
import {
  GEMINI_ACCOUNT_MODELS,
  GROK_ACCOUNT_MODELS,
  QWEN_ACCOUNT_MODELS,
  getBuiltinProviderDefinition,
} from '../src/shared/constants/llm';
import { ModelProviderRegistry } from '../src/main/agent-runtime/ModelProviderRegistry';
import { MultiAgentWorkflowEngine } from '../src/main/workflow/debugger/MultiAgentWorkflowEngine';
import type { HarnessTask, HarnessTaskStatus } from '../src/shared/types/harness';

test('account provider catalog includes Grok, Gemini, and Qwen OAuth adapters', () => {
  const grok = getBuiltinProviderDefinition('grok-account');
  const gemini = getBuiltinProviderDefinition('gemini-account');
  const qwen = getBuiltinProviderDefinition('qwen-account');

  expect(grok).toMatchObject({
    authMode: 'account',
    catalogGroup: 'account',
    modelDiscovery: 'account-catalog',
    accountLoginConfigured: true,
    recommendedModels: GROK_ACCOUNT_MODELS,
  });
  expect(gemini).toMatchObject({
    kind: 'google-ai-studio',
    authMode: 'account',
    recommendedModels: GEMINI_ACCOUNT_MODELS,
  });
  expect(qwen).toMatchObject({
    kind: 'openai-compatible',
    authMode: 'account',
    recommendedModels: QWEN_ACCOUNT_MODELS,
  });
});

test('model provider capability matrix normalizes account and local providers', () => {
  const registry = new ModelProviderRegistry();

  expect(registry.getCapabilities('grok-account')).toMatchObject({
    backendKind: 'mockable-account',
    oauth: true,
    local: false,
    toolCallFormat: 'openai-chat-completions',
    parallelToolCalls: false,
  });
  expect(registry.getCapabilities('gemini-account')).toMatchObject({
    backendKind: 'mockable-account',
    oauth: true,
    toolCallFormat: 'google-gemini',
  });
  expect(registry.getCapabilities('ollama')).toMatchObject({
    backendKind: 'local',
    local: true,
    toolCallFormat: 'openai-chat-completions',
  });
});

test('SDK backend registry keeps fallback adapter behind provider-specific SDK adapters', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src', 'main', 'workflow', 'debugger', 'AgentRunnerRegistry.ts'),
    'utf8',
  );

  expect(source.indexOf('new OpenAiAgentSdkAdapter()')).toBeLessThan(source.indexOf('new LlmAdapterAgentSdkAdapter()'));
  expect(source.indexOf('new ClaudeAgentSdkAdapter()')).toBeLessThan(source.indexOf('new LlmAdapterAgentSdkAdapter()'));
});

test('debugger multi-agent workflow graph is serial and rejects concurrent running tasks', () => {
  const engine = new MultiAgentWorkflowEngine();
  const graph = engine.createDebuggerGraph({
    runId: 'run-1',
    sessionId: 'session-1',
    tasks: [
      task('plan', 'completed'),
      task('dispatch', 'in_progress', ['plan']),
      task('report', 'pending', ['dispatch']),
    ],
  });

  expect(graph).toMatchObject({
    execution: 'serial',
    status: 'running',
    tasks: [
      { id: 'plan', status: 'completed' },
      { id: 'dispatch', status: 'running' },
      { id: 'report', status: 'pending' },
    ],
  });
  expect(() => engine.assertSerialExecution(graph)).not.toThrow();

  const invalidGraph = engine.createDebuggerGraph({
    runId: 'run-1',
    sessionId: 'session-1',
    tasks: [
      task('dispatch', 'in_progress'),
      task('investigate', 'in_progress'),
    ],
  });
  expect(() => engine.assertSerialExecution(invalidGraph)).toThrow(/concurrent running tasks/);
});

function task(taskId: string, status: HarnessTaskStatus, dependsOn: string[] = []): HarnessTask {
  return {
    taskId,
    runId: 'run-1',
    sessionId: 'session-1',
    title: taskId,
    intent: 'investigation',
    objective: taskId,
    status,
    priority: 'normal',
    owner: 'rdc-debugger',
    stage: taskId === 'plan' ? 'plan' : 'dispatch',
    dependsOn,
    evidenceRefs: [],
    artifactRefs: [],
    blockerRefs: [],
    source: 'plan',
    userApproval: 'not_required',
    acceptanceCriteria: [],
    createdAt: '2026-06-05T00:00:00.000Z',
    updatedAt: '2026-06-05T00:00:00.000Z',
  };
}

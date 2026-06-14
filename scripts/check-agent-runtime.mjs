import { createRequire } from 'module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
require('./register-ts-source.cjs');

const repoRoot = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function configuredProvider(id, modelIds) {
  const { createBuiltinProviderEntry } = require('../src/shared/constants/llm.ts');
  const provider = createBuiltinProviderEntry(id);
  return {
    ...provider,
    enabled: true,
    hasStoredSecret: true,
    isConfigured: true,
    status: 'verified',
    models: modelIds.map((modelId) => ({
      id: modelId,
      label: modelId,
      enabled: true,
      contextWindowTokens: null,
    })),
  };
}

function main() {
  const {
    resolveAgentRouteCapability,
    describeRouteCapabilityDiagnostic,
  } = require('../src/main/agent-runtime/capabilities/RouteCapabilityResolver.ts');

  const kimiCapability = resolveAgentRouteCapability(
    configuredProvider('kimi-code', ['kimi-for-coding']),
    'kimi-for-coding',
  );
  assert(kimiCapability.toolCallingMode === 'native-structured', 'kimi-code must resolve to native structured tool calling.');
  assert(kimiCapability.supportsToolResults === true, 'native structured routes must support tool results.');

  const openRouterCapability = resolveAgentRouteCapability(
    configuredProvider('openrouter', ['anthropic/claude-haiku-latest']),
    'anthropic/claude-haiku-latest',
  );
  assert(openRouterCapability.toolCallingMode === 'text-only', 'openrouter must stay text-only until its capability declares tool-calling.');
  assert(
    describeRouteCapabilityDiagnostic(openRouterCapability, 2)?.includes('text-only'),
    'text-only routes with tools should emit a capability diagnostic.',
  );

  const disabledCapability = resolveAgentRouteCapability(undefined, 'missing-model');
  assert(disabledCapability.toolCallingMode === 'disabled', 'missing providers must fail closed.');

  const sharedTypes = read('src/shared/types/agentRuntime.ts');
  for (const token of ['ToolCallingMode', 'ReasoningVisibility', 'AgentRouteCapability', 'native-structured', 'text-only', 'disabled']) {
    assert(sharedTypes.includes(token), `shared agent runtime types must expose ${token}.`);
  }

  const orchestrator = read('src/main/workflow/debugger/AgentOrchestrator.ts');
  assert(orchestrator.includes('configuredRuntimeProvider'), 'AgentOrchestrator must use the configured runtime provider path.');
  assert(!orchestrator.includes('llmAdapterProvider'), 'AgentOrchestrator must not use the settings LLMAdapterProvider.');
  assert(orchestrator.includes('resolveAgentRouteCapability'), 'AgentOrchestrator must gate tools by route capability.');
  assert(orchestrator.includes('activeToolDefinitions'), 'AgentOrchestrator must register only effective tool schemas.');
  assert(orchestrator.includes('route_tool_calling_unsupported'), 'AgentOrchestrator must emit route capability diagnostics.');
  assert(orchestrator.includes('textual_tool_call_not_executed'), 'AgentOrchestrator must normalize textual tool call diagnostics.');
  assert(orchestrator.includes('empty_response_without_tool_call'), 'AgentOrchestrator must normalize empty response diagnostics.');

  assert(!fs.existsSync(path.join(repoRoot, 'src/main/agent-runtime/LLMAdapterProvider.ts')), 'Legacy LLMAdapterProvider must be removed from agent runtime.');

  const configuredProviderSource = read('src/main/agent-runtime/providers/ConfiguredRuntimeProvider.ts');
  assert(configuredProviderSource.includes('settingsService.getLlmConfig()'), 'Configured runtime provider must hydrate Settings provider credentials.');
  assert(configuredProviderSource.includes('AnthropicProvider'), 'Configured runtime provider must map Anthropic-style routes.');
  assert(configuredProviderSource.includes('OpenAICompatibleProvider'), 'Configured runtime provider must map OpenAI-compatible routes.');
  assert(configuredProviderSource.includes('id: decoded.modelId'), 'Configured runtime provider must send the real model id to the provider.');

  const promptComposer = read('src/main/agent-runtime/prompt/PromptComposer.ts');
  assert(promptComposer.includes('native structured tool calling is enabled'), 'PromptComposer must include native structured route instructions.');
  assert(promptComposer.includes('This route cannot execute runtime tools'), 'PromptComposer must include text-only/disabled route instructions.');
  assert(promptComposer.includes('composeRuntimeCatalogPrompt'), 'PromptComposer must own runtime catalog prompt composition.');

  const conversationService = read('src/main/conversation/ConversationService.ts');
  for (const forbidden of ['buildProfileSystemPrompt', 'buildProfileCatalogPrompt', 'buildProfileTurnPrompt', 'mentionsTextualToolCall', 'traceHasRuntimeToolCalls', 'AGENT_WORKBENCH_TOOL_CATALOG']) {
    assert(!conversationService.includes(forbidden), `ConversationService must not keep legacy prompt/text-tool logic: ${forbidden}.`);
  }
  assert(conversationService.includes('composeProfileSystemPrompt'), 'ConversationService must call PromptComposer for system prompts.');
  assert(conversationService.includes('routeCapability: routePreflight.routeCapability'), 'ConversationService must pass route capability into PromptComposer.');

  const settingsService = read('src/main/settings/SettingsService.ts');
  assert(settingsService.includes('capabilities: definition?.capabilities'), 'Settings normalization must hydrate builtin provider capabilities.');

  const bridge = read('src/main/agent-runtime/AgentEventBridge.ts');
  assert(bridge.includes('buildDiagnosticAgentEvent'), 'AgentEventBridge must expose normalized diagnostic event construction.');
  assert(bridge.includes('routeCapability'), 'run.started must carry route capability metadata.');

  const anthropic = read('src/main/agent-runtime/providers/AnthropicProvider.ts');
  for (const token of ['body.tools', 'tool_use', 'input_json_delta', 'tool_result']) {
    assert(anthropic.includes(token), `Anthropic provider must support ${token}.`);
  }

  const openai = read('src/main/agent-runtime/providers/OpenAICompatibleProvider.ts');
  for (const token of ['body.tools', 'tool_choice', 'tool_calls']) {
    assert(openai.includes(token), `OpenAI-compatible provider must support ${token}.`);
  }

  console.log('[agent-runtime] OK');
}

try {
  main();
} catch (error) {
  console.error('[agent-runtime] FAILED');
  console.error(error);
  process.exitCode = 1;
}

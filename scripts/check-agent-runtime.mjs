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

function extractStringLiterals(source) {
  return Array.from(source.matchAll(/'([^']+)'/g), (match) => match[1]);
}

function extractPlanTools(agentManifestServiceSource) {
  const match = /agentId === 'plan'\s*\?\s*\[([\s\S]*?)\]\s*:\s*agentId === 'edit'/m.exec(agentManifestServiceSource);
  assert(match, 'AgentManifestService must keep Plan seed tools split from Edit and executable agents.');
  return extractStringLiterals(match[1]);
}

function assertIncludesAll(values, required, label) {
  for (const value of required) {
    assert(values.includes(value), `${label} must include ${value}.`);
  }
}

function assertIncludesNone(values, forbidden, label) {
  for (const value of forbidden) {
    assert(!values.includes(value), `${label} must not include ${value}.`);
  }
}

function main() {
  const routeResolverSource = read('src/main/agent-runtime/capabilities/RouteCapabilityResolver.ts');
  assert(routeResolverSource.includes('LlmProviderProtocol'), 'RouteCapabilityResolver must use the new LlmProviderProtocol enum.');
  assert(!routeResolverSource.includes('LlmProviderKind'), 'RouteCapabilityResolver must not keep legacy LlmProviderKind.');
assert(routeResolverSource.includes('reasoningDelivery'), 'RouteCapabilityResolver must expose reasoningDelivery.');
assert(routeResolverSource.includes('PROTOCOL_REASONING_DELIVERY'), 'RouteCapabilityResolver must map reasoning delivery by protocol.');
  assert(!routeResolverSource.includes('provider.kind'), 'RouteCapabilityResolver must not route on legacy provider.kind.');

  const {
    resolveAgentRouteCapability,
    describeRouteCapabilityDiagnostic,
  } = require('../src/main/agent-runtime/capabilities/RouteCapabilityResolver.ts');

  const kimiCapability = resolveAgentRouteCapability(
    configuredProvider('kimi-coding-plan', ['kimi-for-coding']),
    'kimi-for-coding',
  );
  assert(kimiCapability.toolCallingMode === 'native-structured', 'kimi-coding-plan must resolve to native structured tool calling.');
  assert(kimiCapability.supportsToolResults === true, 'native structured routes must support tool results.');

  const grokCapability = resolveAgentRouteCapability(
    configuredProvider('grok-account', ['grok-code-fast-1']),
    'grok-code-fast-1',
  );
  assert(grokCapability.toolCallingMode === 'native-structured', 'grok-account must resolve to native structured tool calling.');
  assert(grokCapability.supportsToolResults === true, 'grok-account native structured routes must support tool results.');

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
  for (const token of ['ToolCallingMode', 'ReasoningVisibility', 'ReasoningDelivery', 'AgentRouteCapability', 'native-structured', 'text-only', 'disabled', 'account-oauth']) {
    assert(sharedTypes.includes(token), `shared agent runtime types must expose ${token}.`);
  }

  const agentTypes = read('src/shared/types/agent.ts');
  assert(agentTypes.includes("export type AgentId = 'ask' | 'plan' | 'edit'"), 'Plan must remain a first-class top-level agent id.');
  assert(agentTypes.includes("TOP_LEVEL_AGENT_IDS: AgentId[] = ['ask', 'plan', 'edit'"), 'Plan must stay split in TOP_LEVEL_AGENT_IDS.');

  const layoutTypes = read('src/shared/types/layout.ts');
  assert(layoutTypes.includes("BuiltinAgentMode = 'ask' | 'plan' | 'edit'"), 'Plan must be a built-in agent mode, split from executable app modes.');

  const agentConstants = read('src/shared/constants/agents.ts');
  assert(agentConstants.includes("plan: 'Planning agent"), 'Plan must keep its own agent description.');
  assert(agentConstants.includes('without direct changes'), 'Plan description must state that it does not directly change files.');
  assert(agentConstants.includes("plan: ['workspace_notes']"), 'Plan write scope must stay limited to workspace notes.');

  const agentManifestService = read('src/main/settings/AgentManifestService.ts');
  const planTools = extractPlanTools(agentManifestService);
  assertIncludesAll(
    planTools,
    ['read', 'search', 'web', 'askUser', 'agent', 'todo', 'memory', 'planArtifact', 'handoff'],
    'Plan seed tools',
  );
  assertIncludesNone(
    planTools,
    ['bash', 'write', 'edit', 'rdxContext'],
    'Plan seed tools',
  );
  assert(agentManifestService.includes("handoffs: agentId === 'plan'"), 'Plan must own a dedicated handoff entry.');
  assert(agentManifestService.includes("agent: 'edit'"), 'Plan handoff must target Edit for implementation.');
  assert(agentManifestService.includes("providerId: ''") && agentManifestService.includes("modelId: ''"), 'Invalid or missing Plan routes must persist as empty fail-closed routes.');
  assert(agentManifestService.includes('modelEnabled') && agentManifestService.includes('!modelEnabled'), 'AgentManifestService must fail closed when a selected model is not enabled/configured.');

  const orchestrator = read('src/main/workflow/debugger/AgentOrchestrator.ts');
  assert(orchestrator.includes('configuredRuntimeProvider'), 'AgentOrchestrator must use the configured runtime provider path.');
  assert(!orchestrator.includes('llmAdapterProvider'), 'AgentOrchestrator must not use the settings LLMAdapterProvider.');
  assert(orchestrator.includes('resolveAgentRouteCapability'), 'AgentOrchestrator must gate tools by route capability.');
  assert(orchestrator.includes('activeToolDefinitions'), 'AgentOrchestrator must register only effective tool schemas.');
  assert(orchestrator.includes('route_tool_calling_unsupported'), 'AgentOrchestrator must emit route capability diagnostics.');
  assert(orchestrator.includes('textual_tool_call_not_executed'), 'AgentOrchestrator must normalize textual tool call diagnostics.');
  assert(orchestrator.includes('empty_response_without_tool_call'), 'AgentOrchestrator must normalize empty response diagnostics.');
  assert(orchestrator.includes('agentPermissionPolicyService.evaluate'), 'AgentOrchestrator must mediate tools through AgentPermissionPolicy.');
  assert(orchestrator.includes('agentToolApprovalRequestService.request'), 'AgentOrchestrator must pause for tool approval requests.');
  assert(orchestrator.includes('agentToolApprovalRequestService.autoReview'), 'AgentOrchestrator must emit auto-review decisions.');
  assert(orchestrator.includes('withTemporaryPathAccess'), 'approved external path access must be scoped to the tool execution.');

  assert(!fs.existsSync(path.join(repoRoot, 'src/main/agent-runtime/LLMAdapterProvider.ts')), 'Legacy LLMAdapterProvider must be removed from agent runtime.');

  const configuredProviderSource = read('src/main/agent-runtime/providers/ConfiguredRuntimeProvider.ts');
  assert(configuredProviderSource.includes('settingsService.getLlmConfig()'), 'Configured runtime provider must hydrate Settings provider credentials.');
  assert(configuredProviderSource.includes('AnthropicProvider'), 'Configured runtime provider must map Anthropic-style routes.');
  assert(configuredProviderSource.includes('OpenAICompatibleProvider'), 'Configured runtime provider must map OpenAI-compatible routes.');
  assert(configuredProviderSource.includes('id: decoded.modelId'), 'Configured runtime provider must send the real model id to the provider.');

  const promptSections = read('src/main/agent-runtime/prompt/PromptSections.ts');
  const promptAssembler = read('src/main/agent-runtime/prompt/PromptAssembler.ts');
  assert(promptSections.includes('native structured tool calling is enabled'), 'PromptSections must include native structured route instructions.');
  assert(promptSections.includes('This route cannot execute runtime tools'), 'PromptSections must include text-only/disabled route instructions.');
  assert(promptSections.includes('sectionCatalog'), 'PromptSections must own runtime catalog prompt composition.');
  assert(promptSections.includes('Current permission mode'), 'PromptSections must describe runtime permission mode to the model.');
  assert(promptSections.includes('If the runtime denies or requests approval'), 'PromptSections must tell the model not to route around permission decisions.');
  assert(promptAssembler.includes('DEFAULT_SECTIONS'), 'PromptAssembler must assemble the canonical prompt sections.');

  const conversationService = read('src/main/conversation/ConversationService.ts');
  for (const forbidden of ['buildProfileSystemPrompt', 'buildProfileCatalogPrompt', 'buildProfileTurnPrompt', 'mentionsTextualToolCall', 'traceHasRuntimeToolCalls', 'AGENT_WORKBENCH_TOOL_CATALOG']) {
    assert(!conversationService.includes(forbidden), `ConversationService must not keep legacy prompt/text-tool logic: ${forbidden}.`);
  }
  for (const forbidden of ['TASK_FILE_PATTERN', 'readFileSync(taskFilePath', 'fs.existsSync(taskFilePath']) {
    assert(!conversationService.includes(forbidden), `ConversationService must not preload local files outside the tool permission policy: ${forbidden}.`);
  }
  assert(conversationService.includes('promptAssembler.assembleSystemPrompt'), 'ConversationService must call PromptAssembler for system prompts.');
  assert(conversationService.includes('routeCapability: routePreflight.routeCapability'), 'ConversationService must pass route capability into PromptAssembler.');
  assert(conversationService.includes('permissionSettings: settingsService.getAll().agentRuntime.permissions'), 'ConversationService must pass runtime permission settings into PromptAssembler.');
  assert(conversationService.includes('answerToolApproval'), 'ConversationService must expose tool approval resume.');

  const settingsService = read('src/main/settings/SettingsService.ts');
  assert(settingsService.includes('capabilities: definition?.capabilities'), 'Settings normalization must hydrate builtin provider capabilities.');
  assert(settingsService.includes('agentRuntime'), 'Settings must persist agent runtime permission controls.');

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

  const permissionPolicy = read('src/main/agent-runtime/permissions/AgentPermissionPolicy.ts');
  for (const token of ['full-access', 'auto_review', 'DEFAULT_ROUTINE_COMMAND_PREFIXES', 'readableRoots', 'writableRoots', 'commandUsesExternalPath']) {
    assert(permissionPolicy.includes(token), `AgentPermissionPolicy must cover ${token}.`);
  }

  const toolApprovalService = read('src/main/agent-runtime/permissions/AgentToolApprovalRequestService.ts');
  assert(toolApprovalService.includes('approval.requested'), 'Tool approval service must emit requested events.');
  assert(toolApprovalService.includes('approval.answered'), 'Tool approval service must emit answered events.');

  const primitiveShared = read('src/main/agent-runtime/tools/primitives/_shared.ts');
  assert(primitiveShared.includes('withTemporaryPathAccess'), 'Primitive tools must support scoped temporary path access.');

  const globTool = read('src/main/agent-runtime/tools/primitives/GlobTool.ts');
  assert(globTool.includes('splitExternalPattern'), 'Glob tool must resolve approved external path patterns.');

  console.log('[agent-runtime] OK');
}

try {
  main();
} catch (error) {
  console.error('[agent-runtime] FAILED');
  console.error(error);
  process.exitCode = 1;
}

import { createRequire } from 'module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { assertBuiltinProfileContracts } from './builtin-profile-contracts.mjs';

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
  const { createProviderEntryFromCatalog } = require('../src/main/provider-catalog/ProviderCatalogRegistry.ts');
  const provider = createProviderEntryFromCatalog(id);
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

function effectiveModel(provider, modelId, overrides = {}) {
  return {
    providerId: provider.id,
    modelId,
    label: modelId,
    aliases: [],
    enabled: true,
    route: {
      protocol: provider.protocol,
      baseUrl: provider.baseUrl,
      source: 'catalog',
      contracts: require('../src/main/provider-catalog/ProviderCatalogRegistry.ts')
        .getLoadedProviderSurface(provider.id)?.routes
        .find((route) => route.protocol === provider.protocol)?.contracts,
    },
    availability: 'available',
    contextTiers: [{ id: 'default', label: 'Default', activation: { kind: 'implicit' }, entitlement: 'granted' }],
    defaultBudgetTokens: 128000,
    controls: {
      fast: { state: 'unsupported', fixedValue: false },
      maxContext: { state: 'unsupported', fixedValue: false },
      reasoning: { kind: 'none', supportsOff: true, levels: [], defaultSelection: 'off', wireProfile: { kind: 'none' } },
    },
    toolCalling: { state: 'supported' },
    visionInput: { state: 'unknown' },
    structuredOutput: { state: 'unknown' },
    provenance: [],
    ...overrides,
  };
}

function extractStringLiterals(source) {
  return Array.from(source.matchAll(/'([^']+)'/g), (match) => match[1]);
}

async function main() {
  const { loadProviderSurface } = require('../src/main/provider-catalog/ProviderCatalogRegistry.ts');
  await Promise.all(['kimi-coding-plan', 'grok-account', 'openrouter'].map((id) => loadProviderSurface(id)));
  const routeResolverSource = read('src/main/agent-runtime/capabilities/RouteCapabilityResolver.ts');
  assert(routeResolverSource.includes('LlmProviderProtocol'), 'RouteCapabilityResolver must use the new LlmProviderProtocol enum.');
  assert(!routeResolverSource.includes('LlmProviderKind'), 'RouteCapabilityResolver must not keep legacy LlmProviderKind.');
assert(routeResolverSource.includes('reasoningDelivery'), 'RouteCapabilityResolver must expose reasoningDelivery.');
assert(routeResolverSource.includes('ProviderReasoningContract'), 'RouteCapabilityResolver must expose a provider/model reasoning contract.');
assert(routeResolverSource.includes('createFailClosedProviderContracts'), 'Compatible providers must resolve missing contract evidence through the fail-closed contract factory.');
assert(!routeResolverSource.includes('PROTOCOL_REASONING_DELIVERY'), 'Reasoning semantics must not be inferred from compatibility protocol.');
  assert(!routeResolverSource.includes('provider.kind'), 'RouteCapabilityResolver must not route on legacy provider.kind.');

  const {
    resolveAgentRouteCapability,
    describeRouteCapabilityDiagnostic,
  } = require('../src/main/agent-runtime/capabilities/RouteCapabilityResolver.ts');

  const kimi = configuredProvider('kimi-coding-plan', ['kimi-for-coding']);
  const kimiCapability = resolveAgentRouteCapability(kimi, 'kimi-for-coding', effectiveModel(kimi, 'kimi-for-coding'));
  assert(kimiCapability.toolCallingMode === 'native-structured', 'kimi-coding-plan must resolve to native structured tool calling.');
  assert(kimiCapability.supportsToolResults === true, 'native structured routes must support tool results.');

  const grok = configuredProvider('grok-account', ['grok-4.5']);
  const grokCapability = resolveAgentRouteCapability(grok, 'grok-4.5', effectiveModel(grok, 'grok-4.5', {
    toolCalling: { state: 'unknown' },
  }));
  assert(grokCapability.toolCallingMode === 'text-only', 'grok-account must fail closed while structured tool calling remains unverified.');
  assert(grokCapability.supportsToolResults === false, 'Unverified grok-account routes must not receive synthetic tool-result support.');
  assert(
    describeRouteCapabilityDiagnostic(grokCapability, 2)?.code === 'route_tool_calling_unknown',
    'unknown tool calling must use the unknown diagnostic, not unsupported.',
  );

  const openRouter = configuredProvider('openrouter', ['anthropic/claude-haiku-latest']);
  const openRouterCapability = resolveAgentRouteCapability(openRouter, 'anthropic/claude-haiku-latest', effectiveModel(openRouter, 'anthropic/claude-haiku-latest', {
    toolCalling: { state: 'unsupported' },
  }));
  assert(openRouterCapability.toolCallingMode === 'text-only', 'an explicitly unsupported EffectiveModel must stay text-only.');
  assert(
    describeRouteCapabilityDiagnostic(openRouterCapability, 2)?.code === 'route_tool_calling_unsupported',
    'text-only routes with tools should emit a capability diagnostic.',
  );

  const disabledCapability = resolveAgentRouteCapability(undefined, 'missing-model');
  assert(disabledCapability.toolCallingMode === 'disabled', 'missing providers must fail closed.');

  const sharedTypes = read('src/shared/types/agentRuntime.ts');
  for (const token of ['ToolCallingMode', 'ReasoningVisibility', 'ReasoningDelivery', 'AgentRouteCapability', 'toolCallingEvidence', 'native-structured', 'text-only', 'disabled', 'account-oauth']) {
    assert(sharedTypes.includes(token), `shared agent runtime types must expose ${token}.`);
  }

  const agentTypes = read('src/shared/types/agent.ts');
  assert(agentTypes.includes("export type AgentId = 'general' | 'debugger' | 'analyzer' | 'optimizer'"), 'Top-level AgentId must be the four builtin profiles.');
  assert(agentTypes.includes("TOP_LEVEL_AGENT_IDS: AgentId[] = ['general', 'debugger', 'analyzer', 'optimizer']"), 'TOP_LEVEL_AGENT_IDS must list the four builtin profiles.');
  assert(agentTypes.includes("DEFAULT_AGENT_ID: AgentId = 'general'"), 'Default profile must be general.');

  const layoutTypes = read('src/shared/types/layout.ts');
  assert(layoutTypes.includes("export type AgentMode = 'general' | MissionKind | (string & {})"), 'AgentMode is the Composer profile-id selector.');
  assert(!layoutTypes.includes('BuiltinAgentMode'), 'BuiltinAgentMode must be removed.');
  assert(!layoutTypes.includes('ExecutableAgentMode'), 'ExecutableAgentMode must be removed.');

  const sessionTypes = read('src/shared/types/session.ts');
  assert(sessionTypes.includes("export type MissionId = 'debugger' | 'analyzer' | 'optimizer'"), 'MissionId is the independent mission identity.');
  assert(!sessionTypes.includes('ExecutableAppMode'), 'ExecutableAppMode must be removed.');
  assert(!sessionTypes.includes('mode: ExecutableAppMode'), 'session PlanContract must not use ExecutableAppMode.');
  assert(!sessionTypes.includes("export type AppMode"), 'AppMode must not return.');
  assert(sessionTypes.includes("kind: 'mission'"), "MissionRunRecord has kind: 'mission'.");
  assert(sessionTypes.includes('mission: MissionKind'), 'MissionRunRecord has mission: MissionKind.');
  assert(sessionTypes.includes('profileId: string'), 'DebugSessionStartRequest has profileId: string.');
  assert(sessionTypes.includes('mission?: MissionKind'), 'DebugSessionStartRequest has optional mission?: MissionKind.');

  const harnessTypes = read('src/shared/types/harness.ts');
  assert(!harnessTypes.includes('ExecutableAppMode'), 'harness leftover types must not use ExecutableAppMode.');
  assert(!harnessTypes.includes('mode: ExecutableAppMode'), 'harness leftover types must not use ExecutableAppMode.');

  const agentConstants = read('src/shared/constants/agents.ts');
  assert(agentConstants.includes('Execution Orchestrator'), 'General must be described as Execution Orchestrator.');
  assert(agentConstants.includes('Planning Orchestrator'), 'Mission profiles must be described as Planning Orchestrator.');
  assert(!agentConstants.includes('AGENT_CATEGORIES'), 'AGENT_CATEGORIES must be deleted.');
  assert(!agentConstants.includes('AGENT_WRITE_SCOPES'), 'AGENT_WRITE_SCOPES must be deleted.');

  const agentManifestService = read('src/main/settings/AgentManifestService.ts');
  assert(!agentManifestService.includes('createSeedDefinition'), 'AgentManifestService must not write user seeds.');
  assert(!agentManifestService.includes('ensureSeedManifests'), 'AgentManifestService must not ensure user seeds.');
  assert(agentManifestService.includes('resolveEffectiveSnapshot'), 'AgentManifestService must resolve builtin/user/project snapshots.');
  assert(agentManifestService.includes("providerId: ''") && agentManifestService.includes("modelId: ''"), 'Missing routes must persist as empty fail-closed routes.');
  assert(!agentManifestService.includes('provider.models.some'), 'AgentManifestService must not validate routes against the static settings model list.');
  assert(agentManifestService.includes('EffectiveCatalog is the only'), 'AgentManifestService must preserve explicit routes for EffectiveCatalog validation.');

  assertBuiltinProfileContracts(repoRoot);

  const orchestrator = [
    'src/main/workflow/debugger/AgentOrchestrator.ts',
    'src/main/workflow/debugger/AgentTurnRunner.ts',
    'src/main/workflow/debugger/ToolExecutorFactory.ts',
    'src/main/workflow/debugger/TurnPreparationService.ts',
  ].map(read).join('\n');
  assert(orchestrator.includes('configuredRuntimeProvider'), 'AgentOrchestrator must use the configured runtime provider path.');
  assert(!orchestrator.includes('llmAdapterProvider'), 'AgentOrchestrator must not use the settings LLMAdapterProvider.');
  assert(orchestrator.includes('resolveAgentRouteCapability'), 'AgentOrchestrator must gate tools by route capability.');
  assert(orchestrator.includes('activeToolDefinitions'), 'AgentOrchestrator must register only effective tool schemas.');
  assert(orchestrator.includes('describeRouteCapabilityDiagnostic'), 'AgentOrchestrator must consume structured route capability diagnostics.');
  assert(orchestrator.includes('recordObservedToolCallingSupport'), 'AgentOrchestrator must persist successful structured tool evidence.');
  assert(orchestrator.includes('recordObservedToolCallingUnsupported'), 'AgentOrchestrator must persist explicit tool-calling rejection evidence.');
  assert(orchestrator.includes('isExplicitStructuredToolCallingRejection'), 'AgentOrchestrator must classify explicit tool-calling rejections.');
  assert(orchestrator.includes('textual_tool_call_not_executed'), 'AgentOrchestrator must normalize textual tool call diagnostics.');
  assert(orchestrator.includes('empty_response_without_tool_call'), 'AgentOrchestrator must normalize empty response diagnostics.');
  assert(orchestrator.includes('agentPermissionPolicyService.evaluate'), 'AgentOrchestrator must mediate tools through AgentPermissionPolicy.');
  assert(orchestrator.includes('agentToolApprovalRequestService.request'), 'AgentOrchestrator must pause for tool approval requests.');
  assert(orchestrator.includes('agentToolApprovalRequestService.autoReview'), 'AgentOrchestrator must emit auto-review decisions.');
  assert(orchestrator.includes('withTemporaryPathAccess'), 'approved external path access must be scoped to the tool execution.');
  assert(orchestrator.includes('PromptPlan is required before creating an agent runtime slot.'), 'Agent runtime slots must require PromptPlan.');
  assert(orchestrator.includes('requestEnvelopeBuilder.build'), 'Agent runtime requests must create RequestEnvelope snapshots.');
  assert(!orchestrator.includes('onRequest: promptPlan ?'), 'RequestEnvelope creation must not be optional on provider calls.');

  const routeCapabilityResolver = read('src/main/agent-runtime/capabilities/RouteCapabilityResolver.ts');
  assert(routeCapabilityResolver.includes('route_tool_calling_unknown'), 'Unknown native tool support must use the unknown diagnostic code.');
  assert(routeCapabilityResolver.includes('route_tool_calling_unsupported'), 'Explicit unsupported tool support must use the unsupported diagnostic code.');
  assert(routeCapabilityResolver.includes('route_tool_calling_disabled'), 'Unavailable routes must use the disabled diagnostic code.');
  assert(routeCapabilityResolver.includes('has not confirmed native tool calling'), 'Unknown tool calling must not reuse the explicit-unsupported wording.');
  assert(!read('src/renderer/features/composer/composerModelPicker.ts').includes('isEffectiveModelPickerSelectable'), 'Composer picker must use the Agent tool-eligibility gate.');
  assert(read('src/renderer/features/composer/composerModelPicker.ts').includes('isAgentToolExecutableModel'), 'Composer picker must share the Agent tool-eligibility gate.');

  assert(!fs.existsSync(path.join(repoRoot, 'src/main/agent-runtime/LLMAdapterProvider.ts')), 'Legacy LLMAdapterProvider must be removed from agent runtime.');
  assert(!fs.existsSync(path.join(repoRoot, 'src/main/agent-runtime/cli/StandaloneCli.ts')), 'The unshipped mock StandaloneCli must not return as a second runtime path.');
  assert(!fs.existsSync(path.join(repoRoot, 'src/main/settings/LLMAdapter.ts')), 'Settings-owned legacy LLMAdapter must be removed.');

  const configuredProviderSource = read('src/main/agent-runtime/providers/ConfiguredRuntimeProvider.ts');
  assert(!configuredProviderSource.includes('settingsService'), 'Configured runtime provider must not re-read mutable Settings during a turn.');
  assert(configuredProviderSource.includes('providerRuntimeCredentialService.get'), 'Configured runtime provider must consume an opaque credential lease.');
  assert(configuredProviderSource.includes('providerRuntimeCredentialService.refresh'), 'Account 401 retry must refresh the same credential lease.');
  assert(configuredProviderSource.includes('AnthropicProvider'), 'Configured runtime provider must map Anthropic-style routes.');
  assert(configuredProviderSource.includes('OpenAICompatibleProvider'), 'Configured runtime provider must map OpenAI-compatible routes.');
  assert(configuredProviderSource.includes('const effectiveModelId = requestPlan.effectiveModelId'), 'Configured runtime provider must send the RequestPlan model id.');
  assert(configuredProviderSource.includes('const protocol = requestPlan.route.protocol'), 'Configured runtime provider must route only through RequestPlan.');
  assert(!configuredProviderSource.includes('provider.models'), 'Configured runtime provider must not gate requests with a static model list.');

  const credentialService = read('src/main/settings/ProviderRuntimeCredentialService.ts');
  for (const token of ['async freeze(', 'async refresh(', 'connectionHeaders', 'awsBedrockCredentials', 'release(']) {
    assert(credentialService.includes(token), `Frozen credential service must include ${token}.`);
  }

  const promptPlanBuilder = read('src/main/agent-runtime/prompt/PromptPlanBuilder.ts');
  const requestEnvelopeBuilder = read('src/main/agent-runtime/prompt/RequestEnvelopeBuilder.ts');
  const skillCatalogBudget = read('src/main/agent-runtime/capabilities/SkillCatalogBudget.ts');
  assert(promptPlanBuilder.includes('CORE_FILES'), 'PromptPlanBuilder must assemble source-controlled Core Prompt modules.');
  assert(promptPlanBuilder.includes("kind: 'skill-catalog'"), 'PromptPlanBuilder must own progressive Skill catalog composition.');
  assert(promptPlanBuilder.includes('resolveSkillCatalogBudget'), 'PromptPlanBuilder must use SkillCatalogBudget for progressive skill index.');
  assert(promptPlanBuilder.includes('Permission mode:'), 'PromptPlanBuilder must describe effective runtime permission mode.');
  assert(promptPlanBuilder.includes('routeCapability'), 'PromptPlanBuilder must include effective route capabilities.');
  assert(skillCatalogBudget.includes('includeSkillCatalog'), 'SkillCatalogBudget must decide catalog inclusion.');
  assert(!skillCatalogBudget.includes("harness:"), 'SkillCatalogBudget must not restore harness frontmatter modes.');
  assert(!skillCatalogBudget.includes('HarnessProfile'), 'SkillCatalogBudget must not restore HarnessProfile modes.');
  assert(!fs.existsSync(path.join(repoRoot, 'src/main/agent-runtime/capabilities/HarnessProfileResolver.ts')), 'HarnessProfileResolver must be removed after Progressive Skill convergence.');
  assert(!read('src/shared/types/agentManifest.ts').includes('AgentHarnessPreference'), 'agentManifest must not restore AgentHarnessPreference.');
  assert(requestEnvelopeBuilder.includes('promptPlan'), 'RequestEnvelopeBuilder must produce provider-neutral snapshots from PromptPlan.');
  assert(requestEnvelopeBuilder.includes('requestPlan'), 'RequestEnvelopeBuilder must snapshot the exact RequestPlan sent to the adapter.');
  assert(!fs.existsSync(path.join(repoRoot, 'src/main/agent-runtime/prompt/PromptAssembler.ts')), 'PromptAssembler must be removed after PromptPlan formalization.');

  const conversationService = read('src/main/conversation/ConversationService.ts');
  const conversationPromptPreparer = read('src/main/conversation/ConversationPromptPreparer.ts');
  const conversationTurnStarter = read('src/main/conversation/ConversationTurnStarter.ts');
  const conversationTurnRunner = read('src/main/conversation/ConversationTurnRunner.ts');
  const conversationRuntimeSources = [conversationService, conversationPromptPreparer, conversationTurnStarter, conversationTurnRunner].join('\n');
  assert(conversationPromptPreparer.includes('mergeTurnPreloadSkillIds'), 'Conversation prompt preparation must merge profile/$skill/pending skill preload ids.');
  assert(conversationPromptPreparer.includes('SKILL_UNAVAILABLE'), 'Conversation prompt preparation must fail closed on missing preload skills.');
  for (const forbidden of ['buildProfileSystemPrompt', 'buildProfileCatalogPrompt', 'buildProfileTurnPrompt', 'mentionsTextualToolCall', 'traceHasRuntimeToolCalls', 'AGENT_WORKBENCH_TOOL_CATALOG']) {
    assert(!conversationRuntimeSources.includes(forbidden), `Conversation runtime must not keep legacy prompt/text-tool logic: ${forbidden}.`);
  }
  for (const forbidden of ['TASK_FILE_PATTERN', 'readFileSync(taskFilePath', 'fs.existsSync(taskFilePath']) {
    assert(!conversationRuntimeSources.includes(forbidden), `Conversation runtime must not preload local files outside the tool permission policy: ${forbidden}.`);
  }
  assert(conversationPromptPreparer.includes('promptPlanBuilder.build'), 'Conversation prompt preparation must build a PromptPlan for system instructions.');
  assert(conversationPromptPreparer.includes('routeCapability: input.routePreflight.routeCapability'), 'Conversation prompt preparation must pass the frozen route capability into PromptPlanBuilder.');
  assert(conversationPromptPreparer.includes('permissionSettings: runtimeSettings.agentRuntime.permissions'), 'Conversation prompt preparation must pass runtime permission settings into PromptPlanBuilder.');
  assert(conversationService.includes('answerToolApproval'), 'ConversationService must expose tool approval resume.');
  for (const token of ['prepareTurnContext', 'prepareConversationPrompt', 'materializeAgentUserInput', 'preparedTurn', 'requestId']) {
    assert(conversationRuntimeSources.includes(token), `Conversation preflight path must include ${token}.`);
  }
  assert(conversationRuntimeSources.includes('releaseProviderRuntimeCredentials'), 'Every conversation terminal path must release the opaque credential lease.');
  assert(!conversationRuntimeSources.includes('previewNextRequestContext'), 'Conversation runtime must not restore draft-time context preview work.');

  const contextJournal = read('src/main/conversation/SessionContextJournal.ts');
  for (const token of ['filteredArtifactCount', 'decideContinuationReplay', 'canonicalizeTerminalContextMessages', 'schemaVersion !== 2']) {
    assert(contextJournal.includes(token), `Session context v2 continuation filtering must include ${token}.`);
  }
  const conversationIpc = read('src/main/ipc/conversationHandlers.ts');
  const conversationRejection = read('src/main/conversation/conversationSendRejection.ts');
  assert(conversationIpc.includes("status: 'accepted'"), 'Main IPC must return a structured accepted send result after commit.');
  assert(conversationRejection.includes("status: 'rejected'"), 'Main IPC must return a structured rejected preflight result without persistence.');
  assert(conversationIpc.includes('toRejectedSendResult'), 'Main IPC must map preflight failures through the structured rejection helper.');
  assert(!conversationIpc.includes('conversation:previewNextRequestContext'), 'Main IPC must not expose draft-time context preview.');

  const settingsService = read('src/main/settings/SettingsService.ts');
  assert(settingsService.includes('capabilities: definition?.capabilities'), 'Settings normalization must hydrate builtin provider capabilities.');
  assert(settingsService.includes('agentRuntime'), 'Settings must persist agent runtime permission controls.');
  for (const token of ['saveAgentDefinition(request:', 'agentDefinitionRevisions', 'clientRevision <= latestRevision', 'agentManifestService.routeFromDefinition']) {
    assert(settingsService.includes(token), `Scoped agent-definition save path must include ${token}.`);
  }

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
  for (const token of ['full-access', 'auto_review', 'POSIX_ROUTINE_COMMAND_PREFIXES', 'WINDOWS_ROUTINE_COMMAND_PREFIXES', 'routineCommandPrefixes', 'readableRoots', 'writableRoots', 'commandUsesExternalPath']) {
    assert(permissionPolicy.includes(token), `AgentPermissionPolicy must cover ${token}.`);
  }

  const toolApprovalService = read('src/main/agent-runtime/permissions/AgentToolApprovalRequestService.ts');
  assert(toolApprovalService.includes('approval.requested'), 'Tool approval service must emit requested events.');
  assert(toolApprovalService.includes('approval.answered'), 'Tool approval service must emit answered events.');

  const primitiveShared = read('src/main/agent-runtime/tools/primitives/_shared.ts');
  assert(primitiveShared.includes('withTemporaryPathAccess'), 'Primitive tools must support scoped temporary path access.');

  const globTool = read('src/main/agent-runtime/tools/primitives/GlobTool.ts');
  assert(globTool.includes('splitExternalPattern'), 'Glob tool must resolve approved external path patterns.');

  assert(fs.existsSync(path.join(repoRoot, 'src/shared/provider-catalog/agentToolCapabilityAudit.test.ts')), 'Catalog tool-calling audit must exist.');
  assert(fs.existsSync(path.join(repoRoot, 'src/shared/provider-catalog/protocolWireFixtureCoverage.ts')), 'Native protocol wire-fixture coverage map must exist.');
  const toolCapability = spawnSync(process.execPath, [path.join(repoRoot, 'scripts/check-agent-tool-capability.mjs')], {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
  });
  if (toolCapability.error) throw toolCapability.error;
  if ((toolCapability.status ?? 1) !== 0) {
    throw new Error('Shared Agent tool-capability check failed.');
  }

  console.log('[agent-runtime] OK');
}

try {
  await main();
} catch (error) {
  console.error('[agent-runtime] FAILED');
  console.error(error);
  process.exitCode = 1;
}

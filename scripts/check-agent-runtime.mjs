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
  assert(!routeResolverSource.includes('LlmProviderKind'), 'RouteCapabilityResolver must not keep legacy LlmProviderKind.');
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

  const layoutTypes = read('src/shared/types/layout.ts');
  assert(!layoutTypes.includes('BuiltinAgentMode'), 'BuiltinAgentMode must be removed.');
  assert(!layoutTypes.includes('ExecutableAgentMode'), 'ExecutableAgentMode must be removed.');

  const sessionTypes = read('src/shared/types/session.ts');
  assert(!sessionTypes.includes('ExecutableAppMode'), 'ExecutableAppMode must be removed.');
  assert(!sessionTypes.includes('mode: ExecutableAppMode'), 'session PlanContract must not use ExecutableAppMode.');
  assert(!sessionTypes.includes("export type AppMode"), 'AppMode must not return.');

  const harnessTypes = read('src/shared/types/harness.ts');
  assert(!harnessTypes.includes('ExecutableAppMode'), 'harness leftover types must not use ExecutableAppMode.');
  assert(!harnessTypes.includes('mode: ExecutableAppMode'), 'harness leftover types must not use ExecutableAppMode.');

  const agentConstants = read('src/shared/constants/agents.ts');
  assert(!agentConstants.includes('AGENT_CATEGORIES'), 'AGENT_CATEGORIES must be deleted.');
  assert(!agentConstants.includes('AGENT_WRITE_SCOPES'), 'AGENT_WRITE_SCOPES must be deleted.');

  const agentManifestService = read('src/main/settings/agent-manifests/AgentManifestService.ts');
  assert(!agentManifestService.includes('createSeedDefinition'), 'AgentManifestService must not write user seeds.');
  assert(!agentManifestService.includes('ensureSeedManifests'), 'AgentManifestService must not ensure user seeds.');
  assert(!agentManifestService.includes('provider.models.some'), 'AgentManifestService must not validate routes against the static settings model list.');

  assertBuiltinProfileContracts(repoRoot);

  const orchestrator = [
    'src/main/agent-runtime/orchestration/AgentOrchestrator.ts',
    'src/main/agent-runtime/orchestration/AgentTurnRunner.ts',
    'src/main/agent-runtime/orchestration/AgentTurnSubscription.ts',
    'src/main/agent-runtime/orchestration/AgentTurnCapabilityObservations.ts',
    'src/main/agent-runtime/orchestration/AgentSlotFactory.ts',
    'src/main/agent-runtime/orchestration/ToolExecutorFactory.ts',
    'src/main/agent-runtime/orchestration/TurnPreparationService.ts',
    'src/main/agent-runtime/permissions/ToolPermissionAuthorization.ts',
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
  assert(orchestrator.includes('executeWithPermissionAdmission'), 'Tool effects must use the revision-checked final admission path.');
  assert(!read('src/main/agent-runtime/permissions/AgentPermissionPolicy.ts').includes('settingsService.getAll'), 'Policy evaluation must explicitly receive frozen constraints and main-owned mode.');
  assert(orchestrator.includes('withTemporaryPathAccess'), 'approved external path access must be scoped to the tool execution.');
  assert(orchestrator.includes('PromptPlan is required before creating an agent runtime slot.'), 'Agent runtime slots must require PromptPlan.');
  assert(orchestrator.includes('requestEnvelopeBuilder.build'), 'Agent runtime requests must create RequestEnvelope snapshots.');
  assert(!orchestrator.includes('onRequest: promptPlan ?'), 'RequestEnvelope creation must not be optional on provider calls.');
  assert(!read('src/renderer/features/composer/composerModelPicker.ts').includes('isEffectiveModelPickerSelectable'), 'Composer picker must use the Agent tool-eligibility gate.');

  assert(!fs.existsSync(path.join(repoRoot, 'src/main/agent-runtime/LLMAdapterProvider.ts')), 'Legacy LLMAdapterProvider must be removed from agent runtime.');
  assert(!fs.existsSync(path.join(repoRoot, 'src/main/agent-runtime/cli/StandaloneCli.ts')), 'The unshipped mock StandaloneCli must not return as a second runtime path.');
  assert(!fs.existsSync(path.join(repoRoot, 'src/main/settings/LLMAdapter.ts')), 'Settings-owned legacy LLMAdapter must be removed.');

  const configuredProviderSource = read('src/main/agent-runtime/providers/ConfiguredRuntimeProvider.ts');
  assert(!configuredProviderSource.includes('settingsService'), 'Configured runtime provider must not re-read mutable Settings during a turn.');
  assert(!configuredProviderSource.includes('provider.models'), 'Configured runtime provider must not gate requests with a static model list.');

  const promptPlanBuilder = read('src/main/agent-runtime/prompt/PromptPlanBuilder.ts');
  const skillCatalogBudget = read('src/main/agent-runtime/capabilities/SkillCatalogBudget.ts');
  assert(!promptPlanBuilder.includes('Permission mode:'), 'Frozen PromptPlan must not advertise a stale current permission mode.');
  assert(!skillCatalogBudget.includes("harness:"), 'SkillCatalogBudget must not restore harness frontmatter modes.');
  assert(!skillCatalogBudget.includes('HarnessProfile'), 'SkillCatalogBudget must not restore HarnessProfile modes.');
  assert(!fs.existsSync(path.join(repoRoot, 'src/main/agent-runtime/capabilities/HarnessProfileResolver.ts')), 'HarnessProfileResolver must be removed after Progressive Skill convergence.');
  assert(!read('src/shared/types/agentManifest.ts').includes('AgentHarnessPreference'), 'agentManifest must not restore AgentHarnessPreference.');
  assert(!fs.existsSync(path.join(repoRoot, 'src/main/agent-runtime/prompt/PromptAssembler.ts')), 'PromptAssembler must be removed after PromptPlan formalization.');

  const conversationService = read('src/main/conversation/ConversationService.ts');
  const conversationPromptPreparer = read('src/main/conversation/ConversationPromptPreparer.ts');
  const conversationTurnStarter = read('src/main/conversation/ConversationTurnStarter.ts');
  const conversationTurnRunner = read('src/main/conversation/ConversationTurnRunner.ts');
  const conversationRuntimeSources = [conversationService, conversationPromptPreparer, conversationTurnStarter, conversationTurnRunner].join('\n');
  for (const forbidden of ['buildProfileSystemPrompt', 'buildProfileCatalogPrompt', 'buildProfileTurnPrompt', 'mentionsTextualToolCall', 'traceHasRuntimeToolCalls', 'AGENT_WORKBENCH_TOOL_CATALOG']) {
    assert(!conversationRuntimeSources.includes(forbidden), `Conversation runtime must not keep legacy prompt/text-tool logic: ${forbidden}.`);
  }
  for (const forbidden of ['TASK_FILE_PATTERN', 'readFileSync(taskFilePath', 'fs.existsSync(taskFilePath']) {
    assert(!conversationRuntimeSources.includes(forbidden), `Conversation runtime must not preload local files outside the tool permission policy: ${forbidden}.`);
  }
  assert(!conversationRuntimeSources.includes('previewNextRequestContext'), 'Conversation runtime must not restore draft-time context preview work.');
  const conversationIpc = read('src/main/ipc/conversationHandlers.ts');
  assert(!conversationIpc.includes('conversation:previewNextRequestContext'), 'Main IPC must not expose draft-time context preview.');

  assert(fs.existsSync(path.join(repoRoot, 'src/main/provider-catalog/agentToolCapabilityAudit.test.ts')), 'Catalog tool-calling audit must exist.');
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

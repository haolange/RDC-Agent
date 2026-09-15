import { createRequire } from 'module';
import { scriptExists, scriptRead, scriptReadCssBundle } from './renderer-contract.mjs';

const require = createRequire(import.meta.url);
require('./register-ts-source.cjs');

const { AGENT_ROLES } = require('../src/shared/constants/agents.ts');
const { createProviderEntryFromCatalog } = require('../src/main/provider-catalog/ProviderCatalogRegistry.ts');
const {
  canonicalAgentModelId,
  splitCanonicalAgentModelId,
} = require('../src/shared/utils/agentModelRoute.ts');
const { AgentManifestService } = require('../src/main/settings/AgentManifestService.ts');
const {
  HISTORICAL_RESERVED_AGENT_IDS,
  isHistoricalReservedAgentId,
} = require('../src/main/settings/seed-migration/officialSeedGenerations.ts');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function configuredProvider(id, modelIds) {
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

function route(agentId, providerId, modelId) {
  return { agentId, providerId, modelId };
}

function agentDraft(overrides) {
  return {
    id: overrides.id,
    fileName: overrides.fileName ?? `${overrides.id}.agent.md`,
    name: overrides.name ?? overrides.id,
    description: overrides.description ?? 'Custom profile used by settings regression checks.',
    argumentHint: overrides.argumentHint ?? 'Describe the task for this custom profile',
    target: 'rdc-agent',
    models: overrides.models ?? [],
    icon: overrides.icon ?? 'spark',
    accent: overrides.accent ?? '#33d1ff',
    disableModelInvocation: false,
    userInvocable: overrides.userInvocable ?? true,
    tools: overrides.tools ?? ['read'],
    skills: [],
    mcpServers: [],
    agents: overrides.agents ?? ['edit'],
    handoffs: overrides.handoffs ?? [],
    metadata: {},
    instructions: overrides.instructions ?? 'Use the custom profile instructions.',
    enabled: overrides.enabled ?? true,
  };
}

function writeCustomManifest(filePath, options = {}) {
  const modelLine = options.model ? `model:\n  - ${options.model}\n` : 'model: []\n';
  fs.writeFileSync(filePath, `---
name: ${options.name ?? 'Custom Browser Use Agent'}
description: ${options.description ?? 'A custom user-invocable profile for regression checks.'}
argument-hint: Describe the custom browser-use task
target: rdc-agent
${modelLine}icon: spark
accent: "#33d1ff"
disable-model-invocation: false
user-invocable: true
enabled: true
tools:
  - read
  - search
agents:
  - edit
handoffs:
  - label: Continue in Edit
    agent: edit
    prompt: Continue with the implementation evidence.
---

Follow the custom profile instructions and report runtime evidence.
`, 'utf8');
}

function walkSourceFiles(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkSourceFiles(fullPath));
      continue;
    }
    if (/\.(cjs|mjs|ts|tsx)$/u.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

async function main() {
  const ollama = configuredProvider('ollama', ['llama3']);
  const validRoutes = AGENT_ROLES.map((agentId) => route(agentId, 'ollama', 'llama3'));
  const customAgentId = 'custom-browser-use-agent';

  assert(
    canonicalAgentModelId('deepseek', 'deepseek-chat') === 'deepseek:deepseek-chat',
    'Canonical model id should be providerId:modelId.',
  );
  const splitRoute = splitCanonicalAgentModelId('deepseek:deepseek-chat');
  assert(splitRoute?.providerId === 'deepseek', 'Canonical parser should recover provider id.');
  assert(splitRoute?.modelId === 'deepseek-chat', 'Canonical parser should recover model id.');
  assert(splitCanonicalAgentModelId('deepseek') === null, 'Canonical parser should reject missing model id.');
  assert(splitCanonicalAgentModelId(':deepseek-chat') === null, 'Canonical parser should reject missing provider id.');

  const repoRoot = process.cwd();
  const toRel = (absolute) => path.relative(repoRoot, absolute).replace(/\\/g, '/');
  const readSrcFile = (absolute, enc) => {
    const rel = toRel(absolute);
    if (rel.startsWith('src/')) return scriptRead(rel);
    return fs.readFileSync(absolute, enc);
  };
  const existsSrc = (absolute) => {
    const rel = toRel(absolute);
    if (rel.startsWith('src/')) return scriptExists(rel);
    return fs.existsSync(absolute);
  };
  const agentManifestTypes = readSrcFile(path.join(repoRoot, 'src/shared/types/agentManifest.ts'), 'utf8');
  for (const field of [
    'disableModelInvocation',
    'userInvocable',
    'mcpServers',
    'handoffs',
    'instructions',
    'AgentModelOption',
    'status',
  ]) {
    assert(agentManifestTypes.includes(field), `Agent manifest type should expose ${field}.`);
  }

  const agentsSettings = readSrcFile(
    path.join(repoRoot, 'src/renderer/features/settings/SettingsModal/sections/AgentsSettings.tsx'),
    'utf8',
  );
  const settingsModalSource = readSrcFile(
    path.join(repoRoot, 'src/renderer/features/settings/SettingsModal/index.tsx'),
    'utf8',
  ) + readSrcFile(
    path.join(repoRoot, 'src/renderer/features/settings/SettingsModal/SettingsPageContent.tsx'),
    'utf8',
  );
  const settingsModalTypes = readSrcFile(
    path.join(repoRoot, 'src/renderer/features/settings/SettingsModal/types.ts'),
    'utf8',
  );
  const settingsModalCss = scriptReadCssBundle(
    'src/renderer/features/settings/SettingsModal/SettingsModal.css',
  );
  const skillsAgentsWrapperPath = path.join(repoRoot, 'src/renderer/features/settings/SettingsModal/sections/SkillsAgentsSettings.tsx');
  assert(!existsSrc(skillsAgentsWrapperPath), 'Skills and Agents settings must not keep the combined wrapper component.');
  assert(settingsModalTypes.includes("'skills'") && settingsModalTypes.includes("'agents'"), 'Settings sections should expose Skills and Agents as independent pages.');
  assert(settingsModalTypes.includes("'policy'"), 'Settings sections should expose Policy as a peer page.');
  assert(!settingsModalTypes.includes("'diagnostics'"), 'Settings sections must not restore Diagnostics navigation.');
  assert(!settingsModalTypes.includes('skillsAgents'), 'Settings sections must not expose the old Skills & Agents combined page.');
  assert(settingsModalSource.includes("activeSection === 'skills'"), 'Settings modal should render Skills as an independent page.');
  assert(settingsModalSource.includes("activeSection === 'agents'"), 'Settings modal should render Agents as an independent page.');
  assert(settingsModalSource.includes("activeSection === 'policy'"), 'Settings modal should render Policy as an independent page.');
  assert(settingsModalSource.includes('PolicySettings'), 'Settings modal should render the Policy settings section.');
  assert(!settingsModalSource.includes('DeveloperDiagnosticsSettings'), 'Settings modal must not render Developer Diagnostics.');
  assert(!settingsModalSource.includes('SkillsAgentsSettings'), 'Settings modal must not render the old combined Skills & Agents wrapper.');
  assert(!settingsModalCss.includes('settings-page-skills-agents'), 'Settings CSS must not keep the old combined Skills & Agents page selector.');
  assert(!settingsModalCss.includes('settings-skills-agents-tabs'), 'Settings CSS must not keep the old Skills/Agents segmented tab selector.');
  assert(!settingsModalCss.includes('settings-page-diagnostics'), 'Settings CSS must not keep Diagnostics page selectors.');
  assert(
    existsSrc(path.join(repoRoot, 'src/renderer/features/settings/SettingsModal/sections/PolicySettings.tsx')),
    'PolicySettings.tsx peer section is required.',
  );
  assert(
    !existsSrc(path.join(repoRoot, 'src/renderer/features/settings/SettingsModal/sections/DeveloperDiagnosticsSettings.tsx')),
    'DeveloperDiagnosticsSettings must remain removed.',
  );
  assert(isHistoricalReservedAgentId('ask') && isHistoricalReservedAgentId('plan') && isHistoricalReservedAgentId('edit'), 'ask/plan/edit must be reserved historical ids.');
  assert(isHistoricalReservedAgentId('ask_agent') && isHistoricalReservedAgentId('triage-agent'), 'S0 specialist aliases must be reserved.');
  assert(!isHistoricalReservedAgentId('general') && !isHistoricalReservedAgentId('debugger'), 'Four builtins must not be reserved historical ids.');
  assert(HISTORICAL_RESERVED_AGENT_IDS.has('rdc-debugger'), 'Shared reserved set must include S0 specialist ids.');
  assert(agentsSettings.includes('settings.agents.diagnostics'), 'Agents settings should render the manifest diagnostics list.');
  assert(agentsSettings.includes('data-testid="settings-agent-manifest-diagnostics"'), 'Agents diagnostics must keep a stable test id.');
  assert(agentsSettings.includes('settings.agentManifestTitle'), 'Agents settings should render manifest management.');
  assert(!agentsSettings.includes('settings.patterns'), 'Agents settings must not expose internal pattern configuration.');
  assert(!agentsSettings.includes('rdxCliInvoker'), 'Agents settings must not expose the internal CLI invoker name.');
  const modelCascade = readSrcFile(
    path.join(repoRoot, 'src/renderer/features/settings/SettingsModal/sections/AgentModelCascadeSelect.tsx'),
    'utf8',
  );
  assert(modelCascade.includes('settings-model-cascade'), 'Agents settings should use the provider/model cascade picker.');
  assert(
    modelCascade.includes("from '../../../../ui/Popover'") && modelCascade.includes('open={open}'),
    'Model cascade must anchor through the shared Popover, which owns open state and aria-expanded.',
  );
  assert(!modelCascade.includes('splitCanonicalAgentModelId'), 'Model cascade must not synthesize missing selector options from persisted canonical ids.');
  assert(modelCascade.includes('aria-invalid={invalidSelection}'), 'Model cascade should fail closed with explicit validation for an unavailable persisted selection.');
  assert(modelCascade.includes('settings-agent-model-invalid'), 'Model cascade should render a stable unavailable-selection diagnostic anchor.');
  assert(modelCascade.includes('data-provider-id={group.providerId}'), 'Provider options should expose stable provider ids.');
  assert(modelCascade.includes('data-canonical-id={option.canonicalId}'), 'Model options should expose stable canonical ids.');
  assert(!modelCascade.includes('閫'), 'Model cascade must not hardcode mojibake text.');

  const personalizationSettings = readSrcFile(
    path.join(repoRoot, 'src/renderer/features/settings/SettingsModal/sections/PersonalizationSettings.tsx'),
    'utf8',
  );
  assert(personalizationSettings.includes('settings.globalInstructions'), 'Personalization settings should expose global instructions.');
  const runtimeScopePanel = [
    readSrcFile(
      path.join(repoRoot, 'src/renderer/features/settings/SettingsModal/sections/RuntimeScopePanel.tsx'),
      'utf8',
    ),
    readSrcFile(
      path.join(repoRoot, 'src/renderer/features/settings/SettingsModal/sections/runtimeScopeActions.ts'),
      'utf8',
    ),
  ].join('\n');
  const scopedResourceForm = readSrcFile(
    path.join(repoRoot, 'src/renderer/features/settings/SettingsModal/sections/scopedResourceForm.ts'),
    'utf8',
  );
  assert(scopedResourceForm.includes("kind === 'skill'") && scopedResourceForm.includes('allowed-tools'), 'Skill settings should create standard scoped SKILL.md content through the canonical scoped resource form.');
  assert(runtimeScopePanel.includes('rdxRuntime.upsertResource') && runtimeScopePanel.includes('rdxRuntime.deleteResource'), 'Scoped resources should use the canonical RDX Runtime write API.');
  const toolsSettings = readSrcFile(
    path.join(repoRoot, 'src/renderer/features/settings/SettingsModal/sections/ToolsSettings.tsx'),
    'utf8',
  );
  assert(toolsSettings.includes('RdxCliInvokerSettingsFields'), 'Tools settings should render the local RenderDoc toolchain.');
  assert(!toolsSettings.includes('onUpsertMcpServer'), 'Tools settings must not keep the removed Settings-owned MCP write path.');
  const mcpServicesPanel = readSrcFile(
    path.join(repoRoot, 'src/renderer/features/settings/SettingsModal/sections/McpServicesPanel.tsx'),
    'utf8',
  );
  assert(settingsModalSource.includes('McpServicesPanel') && mcpServicesPanel.includes("kinds={['mcp']}"), 'Tools settings should expose Project-aware MCP resources through RuntimeScopePanel.');
  const renderDocToolchain = readSrcFile(
    path.join(repoRoot, 'src/renderer/features/settings/SettingsModal/sections/RdxCliInvokerSettingsFields.tsx'), 'utf8',
  );
  assert(renderDocToolchain.includes('settings.localRenderDocToolchain'), 'Skills & Tools should expose the local RenderDoc toolchain.');
  assert(renderDocToolchain.includes('validateRdxInstallation') && renderDocToolchain.includes('summary.runtime.version')
    && renderDocToolchain.includes('summary.runtime.catalog.toolCount'), 'Installation validation must show actual version and discovered capability count.');
  assert(renderDocToolchain.includes('summary.cli.unavailableReason') && renderDocToolchain.includes('settings.rdxSaveBeforeVerify'),
    'Installation validation must preserve explicit failure and unsaved-configuration states.');
  assert(!toolsSettings.includes('RdxActionsFields') && !renderDocToolchain.includes('catalogPath')
    && !renderDocToolchain.includes('jsonMode'), 'Settings must not restore lifecycle command templates or separate catalog/JSON modes.');

  const composer = readSrcFile(path.join(repoRoot, 'src/renderer/features/composer/Composer.tsx'), 'utf8');
  const composerAgentMenu = readSrcFile(
    path.join(repoRoot, 'src/renderer/features/composer/ComposerAgentMenu.tsx'),
    'utf8',
  );
  assert(
    composer.includes('userInvocableAgents={userInvocableAgents}')
      && composerAgentMenu.includes('userInvocableAgents.map'),
    'Composer should list user-invocable Agent manifests through the canonical Agent menu.',
  );
  assert(!composer.includes('AGENT_MODES.map'), 'Composer should not hardcode mode entries as Agent choices.');
  assert(composerAgentMenu.includes('composer-agent-menu-item-tooltip'), 'Composer should keep Agent descriptions in hover tooltip UI.');
  const capabilityHook = readSrcFile(
    path.join(repoRoot, 'src/renderer/features/composer/useEffectiveModelCapability.ts'),
    'utf8',
  );
  const turnControls = readSrcFile(
    path.join(repoRoot, 'src/renderer/features/composer/useTurnControls.ts'),
    'utf8',
  );
  assert(capabilityHook.includes("status: 'syncing-route'"), 'Composer capability resolution should wait for the committed Agent route revision.');
  assert(capabilityHook.includes('routeCommitKey'), 'Composer capability resolution should re-run on Agent route commits even when route text is unchanged.');
  assert(capabilityHook.includes('validateCapabilityResolution'), 'Capability mismatches should terminate as unavailable instead of loading forever.');
  assert(capabilityHook.includes("status: 'error'"), 'Capability request failures should have an explicit error state.');
  assert(!capabilityHook.includes('catch {'), 'Capability request failures must not be swallowed by an empty catch.');
  assert(!turnControls.includes(':pending'), 'Turn controls must not retain the legacy pending capability-key sentinel.');
  assert(turnControls.includes('capabilityState'), 'Turn controls should consume the closed capability resolution state.');

  const modeGlyph = readSrcFile(path.join(repoRoot, 'src/renderer/ui/ModeGlyph.tsx'), 'utf8');
  assert(modeGlyph.includes('FALLBACK_MODE_CONFIG'), 'ModeGlyph should provide a safe fallback for custom Agent profiles.');

  const composerSendHelpers = readSrcFile(path.join(repoRoot, 'src/renderer/stores/conversationSendHelpers.ts'), 'utf8');
  assert(composerSendHelpers.includes('resolveComposerProfileId'), 'Composer send should freeze the selected profile id without Ask/Edit fallback.');
  const composerSendFlow = readSrcFile(path.join(repoRoot, 'src/renderer/features/composer/composerSendFlow.ts'), 'utf8');
  assert(composerSendFlow.includes('agentId: selectedAgentId || null'), 'Conversation sends should freeze the selected Agent id.');
  assert(composerSendFlow.includes('setPromptValue(sentPrompt)') && composerSendFlow.includes('setPendingAttachments(sentAttachments)'), 'Local preflight failures should restore the Composer snapshot.');
  assert(!composerSendFlow.includes('setSelectedAgentId'), 'Local send failures must not rewrite the selected Agent id.');

  assert(!existsSrc(path.join(repoRoot, 'src/renderer/features/transcript/useAgentHandoffActions.ts')), 'Dead renderer handoff actions must be deleted.');
  assert(!fs.existsSync(path.join(repoRoot, 'src/shared/types/profileHandoff.ts')), 'Durable ProfileHandoffState must stay deleted.');
  assert(!fs.existsSync(path.join(repoRoot, 'src/main/sessions/HandoffStateStore.ts')), 'HandoffStateStore must stay deleted.');
  assert(!fs.existsSync(path.join(repoRoot, 'src/main/agent-runtime/agent/HandoffController.ts')), 'HandoffController must stay deleted.');
  const executionOffer = readSrcFile(path.join(repoRoot, 'src/shared/types/executionOffer.ts'), 'utf8');
  assert(executionOffer.includes('export interface ExecutionOffer'), 'ExecutionOffer must be the session continue-binding record.');
  const conversationService = readSrcFile(path.join(repoRoot, 'src/main/conversation/ConversationService.ts'), 'utf8');
  assert(!conversationService.includes('pendingHandoffs'), 'ConversationService must not keep an in-memory pendingHandoffs map.');
  assert(!conversationService.includes('scheduleHandoffAutoSend'), 'ConversationService must not auto-send declared continues.');
  const applyDeclared = readSrcFile(path.join(repoRoot, 'src/main/conversation/applyDeclaredHandoff.ts'), 'utf8');
  assert(applyDeclared.includes('dispatchRuntimeHooks(\'agent.before-handoff\''), 'Declared continue must fire agent.before-handoff.');
  const sessionApi = readSrcFile(path.join(repoRoot, 'src/shared/renderer-api/workbench.ts'), 'utf8');
  assert(sessionApi.includes('setAgentId'), 'Manual Agent switch must persist session.agentId through main.');
  assert(sessionApi.includes('applyDeclaredHandoff'), 'Declared continue must persist session.agentId through main.');

  const useSettingsModal = readSrcFile(path.join(repoRoot, 'src/renderer/features/settings/SettingsModal/useSettingsModal.ts'), 'utf8');
  assert(!useSettingsModal.includes('AGENT_ROLES'), 'Settings route validation should derive agents from manifest drafts.');
  assert(useSettingsModal.includes('useAgentManifestAutosave'), 'Settings should persist manifest drafts through the scoped autosave path.');
  assert(useSettingsModal.includes('saveAgentDefinition'), 'Settings should use the scoped Agent definition save service.');

  const agentManifestAutosave = readSrcFile(path.join(repoRoot, 'src/renderer/features/settings/SettingsModal/useAgentManifestAutosave.ts'), 'utf8');
  assert(agentManifestAutosave.includes('getChangedAgentManifestDrafts'), 'Agent autosave should write only changed manifest drafts.');
  assert(agentManifestAutosave.includes('latestRevisionRef'), 'Agent autosave should reject stale save completions by revision.');

  const settingsModalActions = readSrcFile(path.join(repoRoot, 'src/renderer/features/settings/SettingsModal/settingsModalActions.ts'), 'utf8');
  assert(!settingsModalActions.includes('AGENT_ROLES'), 'Settings route save should not be limited to built-in Agent roles.');
  assert(settingsModalActions.includes('agentManifestDrafts'), 'Settings route save should include custom manifest drafts.');
  assert(settingsModalActions.includes('saveAgentDefinition'), 'Settings route save should not rebuild the whole settings/workspace state.');

  const agentManifestServiceSource = readSrcFile(path.join(repoRoot, 'src/main/settings/AgentManifestService.ts'), 'utf8');
  assert(!agentManifestServiceSource.includes('Only top-level agent manifests'), 'Agent manifest import should not reject safe custom profiles.');
  assert(agentManifestServiceSource.includes('isSafeAgentProfileId(idFromFileName(entry))'), 'Agent manifest load should accept safe custom profile file ids.');
  assert(agentManifestServiceSource.includes('const routeAgentIds = new Set<string>(AGENT_ROLES)'), 'Agent manifest routes should seed built-ins before adding custom profiles.');
  assert(agentManifestServiceSource.includes('routeAgentIds.add(definition.id)'), 'Agent manifest routes should add custom profile ids.');

  const settingsServiceSource = readSrcFile(path.join(repoRoot, 'src/main/settings/SettingsService.ts'), 'utf8');
  const settingsProviderSanitizeSource = readSrcFile(
    path.join(repoRoot, 'src/main/settings/settingsProviderSanitize.ts'),
    'utf8',
  );
  const settingsServiceHelpersSource = readSrcFile(
    path.join(repoRoot, 'src/main/settings/settingsServiceHelpers.ts'),
    'utf8',
  );
  assert(!settingsProviderSanitizeSource.includes('KNOWN_AGENT_IDS'), 'Settings route normalization should not use a built-in Agent allowlist.');
  assert(settingsProviderSanitizeSource.includes('isSafeAgentProfileId(route.agentId)'), 'Settings route normalization should validate safe custom profile ids.');
  assert(settingsProviderSanitizeSource.includes('routeMap.set(route.agentId, route)'), 'Settings route normalization should preserve custom route ids.');
  assert(!settingsServiceSource.includes('agentRoutes?: LlmAgentRoute[];'), 'Persisted settings must not mirror Agent routes.');
  assert(settingsServiceHelpersSource.includes('routesFromDefinitions(createEmptyAgentRoutes(), baseAgentSettings.definitions)'), 'Runtime Agent routes must derive from .agent.md definitions.');

  const conversationRoutePreflightSource = readSrcFile(
    path.join(repoRoot, 'src/main/conversation/ConversationRoutePreflight.ts'),
    'utf8',
  );
  assert(conversationRoutePreflightSource.includes('resolveEnabledAgentDefinition'), 'Conversation routing should resolve enabled manifest definitions.');
  assert(!conversationRoutePreflightSource.includes('KNOWN_CONVERSATION_AGENTS'), 'Conversation routing should not be limited to built-in Agent roles.');

  const orchestratorSource = readSrcFile(path.join(repoRoot, 'src/main/workflow/debugger/AgentOrchestrator.ts'), 'utf8');
  assert(orchestratorSource.includes('getOrCreateAgentConfig'), 'Agent orchestrator should lazily initialize custom Agent config.');
  const agentSlotRegistrySource = readSrcFile(
    path.join(repoRoot, 'src/main/workflow/debugger/AgentSlotRegistry.ts'),
    'utf8',
  );
  assert(agentSlotRegistrySource.includes('DEFAULT_AGENT_ID'), 'Custom Agent fallback config should use general, not edit.');

  const runtimePolicySource = readSrcFile(path.join(repoRoot, 'src/main/workflow/debugger/DebuggerRuntimePolicy.ts'), 'utf8');
  assert(
    runtimePolicySource.includes('finalizeAllowlist')
    && (runtimePolicySource.includes('manifest.tools') || runtimePolicySource.includes('expandMissionPlanOnlyTokens')),
    'Runtime tool policy should derive manifest tool allowlists directly.',
  );
  assert(runtimePolicySource.includes('AGENT_TOOLS_EMPTY'), 'Runtime tool policy must fail-closed on empty tools.');

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-agent-settings-agents-'));
  try {
    const agentsPath = path.join(tempRoot, 'agents');
    const instructionsPath = path.join(tempRoot, 'RDX.md');
    fs.mkdirSync(agentsPath, { recursive: true });
    const customManifestPath = path.join(agentsPath, `${customAgentId}.agent.md`);
    writeCustomManifest(customManifestPath, {
      model: canonicalAgentModelId('ollama', 'llama3'),
    });

    const manifestService = new AgentManifestService();
    const manifestSettings = manifestService.getSettings({ agentsPath, instructionsPath }, [ollama], validRoutes);
    const customDefinition = manifestSettings.definitions.find((definition) => definition.id === customAgentId);
    assert(customDefinition, 'Agent manifest settings should load a safe custom .agent.md profile.');
    assert(customDefinition.userInvocable === true, 'Custom profile should preserve user-invocable status.');
    assert(customDefinition.tools.includes('read') && customDefinition.tools.includes('search'), 'Custom profile should preserve declared tools.');
    assert(customDefinition.handoffs.some((handoff) => handoff.agent === 'edit'), 'Custom profile should preserve handoff definitions.');

    const routeSettings = manifestService.routesFromDefinitions(validRoutes, manifestSettings.definitions);
    const customRoute = routeSettings.find((entry) => entry.agentId === customAgentId);
    assert(customRoute?.providerId === 'ollama' && customRoute.modelId === 'llama3', 'Custom manifest model should derive a valid route.');
    for (const agentId of AGENT_ROLES) {
      assert(routeSettings.some((entry) => entry.agentId === agentId), `Routes should retain built-in Agent route ${agentId}.`);
    }

    const savedAgentId = 'custom-saved-agent';
    let mismatchRejected = false;
    try {
      await manifestService.saveDefinition({ agentsPath, instructionsPath }, agentDraft({
        id: savedAgentId,
        fileName: 'wrong-file-name.agent.md',
        models: [canonicalAgentModelId('ollama', 'llama3')],
      }));
    } catch (error) {
      mismatchRejected = String(error instanceof Error ? error.message : error).includes('AGENT_MANIFEST_FILENAME_MISMATCH');
    }
    assert(mismatchRejected, 'Saving a profile whose file stem does not equal id must be rejected.');
    assert(!fs.existsSync(path.join(agentsPath, 'wrong-file-name.agent.md')), 'Rejected filename mismatch must not write the submitted file name.');
    assert(!fs.existsSync(path.join(agentsPath, `${savedAgentId}.agent.md`)), 'Rejected filename mismatch must not write a different profile file.');
    await manifestService.saveDefinition({ agentsPath, instructionsPath }, agentDraft({
      id: savedAgentId,
      fileName: `${savedAgentId}.agent.md`,
      models: [canonicalAgentModelId('ollama', 'llama3')],
    }));
    manifestService.saveGlobalInstructions({ instructionsPath }, 'global custom instructions');
    assert(fs.existsSync(path.join(agentsPath, `${savedAgentId}.agent.md`)), 'Saving a custom profile should write a safe id-based file name.');
    const savedSettings = manifestService.getSettings({ agentsPath, instructionsPath }, [ollama], validRoutes);
    assert(savedSettings.definitions.some((definition) => definition.id === savedAgentId), 'Saved custom profile should reload by custom id.');

    const invalidRouteSettings = manifestService.routesFromDefinitions([], [
      agentDraft({
        id: 'custom-invalid-route-agent',
        models: [canonicalAgentModelId('ollama', 'missing-model')],
      }),
    ]);
    const invalidRoute = invalidRouteSettings.find((entry) => entry.agentId === 'custom-invalid-route-agent');
    assert(
      invalidRoute?.providerId === 'ollama' && invalidRoute.modelId === 'missing-model',
      'Manifest save must preserve an explicit route; EffectiveCatalog rejects unavailable models at execution time.',
    );

    const importPath = path.join(tempRoot, 'custom-imported-agent.agent.md');
    writeCustomManifest(importPath, {
      name: 'Custom Imported Agent',
      model: canonicalAgentModelId('ollama', 'llama3'),
    });
    const imported = await manifestService.importFile({ agentsPath, instructionsPath }, importPath);
    assert(imported.id === 'custom-imported-agent', 'Import should accept safe non-built-in .agent.md profiles.');

    fs.writeFileSync(path.join(agentsPath, 'ask.agent.md'), `---
id: leftover-ask
name: Leftover Ask
description: Surviving reserved filename used to assert user-scope diagnostics.
argument-hint: unused
target: rdc-agent
model: []
icon: spark
accent: "#33d1ff"
disable-model-invocation: false
user-invocable: true
enabled: true
tools:
  - read
agents: []
handoffs: []
---

Reserved historical filename.
`, 'utf8');
    writeCustomManifest(path.join(agentsPath, 'plan.agent.md'), { name: 'Historical Plan' });

    const projectRoot = path.join(tempRoot, 'project');
    const projectAgents = path.join(projectRoot, '.rdx', 'agents');
    fs.mkdirSync(projectAgents, { recursive: true });
    writeCustomManifest(path.join(projectAgents, 'edit.agent.md'), { name: 'Project Edit' });
    writeCustomManifest(path.join(projectAgents, 'ask.agent.md'), { name: 'Project Ask' });

    const reservedSettings = manifestService.getSettings(
      { agentsPath, instructionsPath },
      [ollama],
      validRoutes,
      [],
      projectRoot,
    );
    const effectiveIds = reservedSettings.definitions.map((definition) => definition.id);
    const userInvocableIds = reservedSettings.definitions
      .filter((definition) => definition.userInvocable)
      .map((definition) => definition.id);
    for (const illegalId of ['ask', 'plan', 'edit']) {
      assert(!effectiveIds.includes(illegalId), `Effective snapshot must not include reserved id ${illegalId}.`);
      assert(!userInvocableIds.includes(illegalId), `Settings/Composer user-invocable set must not include ${illegalId}.`);
    }
    assert(
      reservedSettings.diagnostics.some((entry) => (
        entry.includes('AGENT_ID_RESERVED_HISTORICAL') && entry.includes('user') && entry.includes('ask')
      )),
      'User reserved historical ids must emit AGENT_ID_RESERVED_HISTORICAL.',
    );
    assert(
      reservedSettings.diagnostics.some((entry) => (
        entry.includes('AGENT_ID_RESERVED_HISTORICAL') && entry.includes('project')
      )),
      'Project reserved historical ids must emit AGENT_ID_RESERVED_HISTORICAL.',
    );
    assert(fs.existsSync(path.join(projectAgents, 'edit.agent.md')), 'Project reserved files must not be auto-deleted.');
    assert(fs.existsSync(path.join(projectAgents, 'ask.agent.md')), 'Project reserved files must remain on disk.');
    assert(!fs.existsSync(path.join(agentsPath, 'plan.agent.md')), 'Matching user historical plan seed must be purged.');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  const forbiddenLegacyTokens = [
    'reasoningTrace',
    'LegacyTraceStep',
    'LegacyTrace',
    'migrateLegacyTrace',
    'LEGACY_STAGE_MIGRATION',
  ];
  for (const filePath of walkSourceFiles(path.join(repoRoot, 'src'))) {
    const content = fs.readFileSync(filePath, 'utf8');
    for (const token of forbiddenLegacyTokens) {
      assert(!content.includes(token), `${path.relative(repoRoot, filePath)} should not write or expose ${token}.`);
    }
  }

  const agentEditorSource = readSrcFile(
    path.join(repoRoot, 'src/renderer/features/settings/SettingsModal/sections/AgentManifestEditor.tsx'),
    'utf8',
  );
  const agentIdentitySource = readSrcFile(
    path.join(repoRoot, 'src/renderer/features/settings/SettingsModal/sections/AgentIdentityPanel.tsx'),
    'utf8',
  );
  assert(agentIdentitySource.includes("from '../../../../ui/ColorField'"), 'Agents accent must use shared ColorField');
  assert(agentIdentitySource.includes('testId="settings-agent-accent"'), 'Agents accent must keep a stable test id');
  assert(agentIdentitySource.includes('AgentIconPresetPicker') && agentIdentitySource.includes('settings-agent-identity-grid'), 'Agents Icon+Accent live in the identity panel (A02), not a separate look strip');
  assert(agentIdentitySource.includes('layout="inline"'), 'Agents accent ColorField must use inline layout');
  assert(!agentEditorSource.includes('settings-agent-accent-field'), 'Agents must not keep the legacy toolbar accent field markup');
  assert(!agentEditorSource.includes('settings-agent-identity-controls'), 'legacy stacked identity-controls row must be removed');
  assert(!agentEditorSource.includes('settings-agent-look-strip'), 'legacy look strip must be removed from the route panel');
  assert(!settingsModalCss.includes('.settings-agent-accent-field'), 'legacy Agents accent CSS must be removed');
  assert(!settingsModalCss.includes('.settings-agent-accent-hex'), 'legacy Agents accent hex CSS must be removed');
  assert(!settingsModalCss.includes('.settings-agent-look-strip'), 'legacy Agents look strip CSS must be removed');
  assert(
    agentEditorSource.includes('settings-agent-config-status') && agentEditorSource.includes("from '../../../../ui/Switch'"),
    'Agents route panel must show a read-only configuration status and Switch-based availability flags',
  );
  assert(
    agentEditorSource.includes('settings-agent-panels') && agentEditorSource.includes('aria-expanded={open}'),
    'Agents Identity / Permissions / Handoffs / Instructions must be accordion panels',
  );

  console.log('[settings-agents] OK');
}

try {
  await main();
} catch (error) {
  console.error('[settings-agents] FAILED');
  console.error(error);
  process.exitCode = 1;
}

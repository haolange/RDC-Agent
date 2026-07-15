import { createRequire } from 'module';

const require = createRequire(import.meta.url);
require('./register-ts-source.cjs');

const { AGENT_ROLES } = require('../src/shared/constants/agents.ts');
const { createProviderEntryFromCatalog } = require('../src/main/provider-catalog/ProviderCatalogRegistry.ts');
const {
  canonicalAgentModelId,
  splitCanonicalAgentModelId,
} = require('../src/shared/utils/agentModelRoute.ts');
const { AgentManifestService } = require('../src/main/settings/AgentManifestService.ts');
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
${modelLine}disable-model-invocation: false
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
  const agentManifestTypes = fs.readFileSync(path.join(repoRoot, 'src/shared/types/agentManifest.ts'), 'utf8');
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

  const agentsSettings = fs.readFileSync(
    path.join(repoRoot, 'src/renderer/features/settings/SettingsModal/sections/AgentsSettings.tsx'),
    'utf8',
  );
  const settingsModalSource = fs.readFileSync(
    path.join(repoRoot, 'src/renderer/features/settings/SettingsModal/index.tsx'),
    'utf8',
  );
  const settingsModalTypes = fs.readFileSync(
    path.join(repoRoot, 'src/renderer/features/settings/SettingsModal/types.ts'),
    'utf8',
  );
  const settingsModalCss = fs.readFileSync(
    path.join(repoRoot, 'src/renderer/features/settings/SettingsModal/SettingsModal.css'),
    'utf8',
  );
  const skillsAgentsWrapperPath = path.join(repoRoot, 'src/renderer/features/settings/SettingsModal/sections/SkillsAgentsSettings.tsx');
  assert(!fs.existsSync(skillsAgentsWrapperPath), 'Skills and Agents settings must not keep the combined wrapper component.');
  assert(settingsModalTypes.includes("'skills'") && settingsModalTypes.includes("'agents'"), 'Settings sections should expose Skills and Agents as independent pages.');
  assert(!settingsModalTypes.includes('skillsAgents'), 'Settings sections must not expose the old Skills & Agents combined page.');
  assert(settingsModalSource.includes("activeSection === 'skills'"), 'Settings modal should render Skills as an independent page.');
  assert(settingsModalSource.includes("activeSection === 'agents'"), 'Settings modal should render Agents as an independent page.');
  assert(!settingsModalSource.includes('SkillsAgentsSettings'), 'Settings modal must not render the old combined Skills & Agents wrapper.');
  assert(!settingsModalCss.includes('settings-page-skills-agents'), 'Settings CSS must not keep the old combined Skills & Agents page selector.');
  assert(!settingsModalCss.includes('settings-skills-agents-tabs'), 'Settings CSS must not keep the old Skills/Agents segmented tab selector.');
  assert(agentsSettings.includes('settings.agentManifestTitle'), 'Agents settings should render manifest management.');
  assert(!agentsSettings.includes('settings.patterns'), 'Agents settings must not expose internal pattern configuration.');
  assert(!agentsSettings.includes('rdxCliInvoker'), 'Agents settings must not expose the internal CLI invoker name.');
  const modelCascade = fs.readFileSync(
    path.join(repoRoot, 'src/renderer/features/settings/SettingsModal/sections/AgentModelCascadeSelect.tsx'),
    'utf8',
  );
  assert(modelCascade.includes('settings-model-cascade'), 'Agents settings should use the provider/model cascade picker.');
  assert(modelCascade.includes('aria-expanded={open}'), 'Model cascade should have explicit open state.');
  assert(modelCascade.includes('splitCanonicalAgentModelId'), 'Model cascade should keep unavailable canonical model ids readable.');
  assert(modelCascade.includes('data-provider-id={group.providerId}'), 'Provider options should expose stable provider ids.');
  assert(modelCascade.includes('data-canonical-id={option.canonicalId}'), 'Model options should expose stable canonical ids.');
  assert(!modelCascade.includes('閫'), 'Model cascade must not hardcode mojibake text.');

  const personalizationSettings = fs.readFileSync(
    path.join(repoRoot, 'src/renderer/features/settings/SettingsModal/sections/PersonalizationSettings.tsx'),
    'utf8',
  );
  assert(personalizationSettings.includes('settings.globalInstructions'), 'Personalization settings should expose global instructions.');
  const runtimeScopePanel = fs.readFileSync(
    path.join(repoRoot, 'src/renderer/features/settings/SettingsModal/sections/RuntimeScopePanel.tsx'),
    'utf8',
  );
  const scopedResourceForm = fs.readFileSync(
    path.join(repoRoot, 'src/renderer/features/settings/SettingsModal/sections/scopedResourceForm.ts'),
    'utf8',
  );
  assert(scopedResourceForm.includes("kind === 'skill'") && scopedResourceForm.includes('allowed-tools'), 'Skill settings should create standard scoped SKILL.md content through the canonical scoped resource form.');
  assert(runtimeScopePanel.includes('rdxRuntime.upsertResource') && runtimeScopePanel.includes('rdxRuntime.deleteResource'), 'Scoped resources should use the canonical RDX Runtime write API.');
  const toolsSettings = fs.readFileSync(
    path.join(repoRoot, 'src/renderer/features/settings/SettingsModal/sections/ToolsSettings.tsx'),
    'utf8',
  );
  assert(toolsSettings.includes('RdxCliInvokerSettingsFields'), 'Tools settings should render the local RenderDoc toolchain.');
  assert(!toolsSettings.includes('onUpsertMcpServer'), 'Tools settings must not keep the removed Settings-owned MCP write path.');
  assert(settingsModalSource.includes("kinds={['mcp']}"), 'Tools settings should expose Project-aware MCP resources through RuntimeScopePanel.');
  const renderDocToolchain = fs.readFileSync(
    path.join(repoRoot, 'src/renderer/features/settings/SettingsModal/sections/RdxCliInvokerSettingsFields.tsx'),
    'utf8',
  );
  assert(renderDocToolchain.includes('settings.localRenderDocToolchain'), 'Skills & Tools should expose the local RenderDoc toolchain.');
  assert(renderDocToolchain.includes('settings-rdx-actions'), 'Skills & Tools should expose Settings-managed RDX shell actions.');
  assert(renderDocToolchain.includes('openCapture'), 'RDX shell actions should include the open capture action.');

  const composer = fs.readFileSync(path.join(repoRoot, 'src/renderer/features/debugger/composer/Composer.tsx'), 'utf8');
  assert(composer.includes('userInvocableAgents.map'), 'Composer should list user-invocable Agent manifests.');
  assert(!composer.includes('AGENT_MODES.map'), 'Composer should not hardcode mode entries as Agent choices.');
  assert(composer.includes('composer-agent-menu-item-tooltip'), 'Composer should keep Agent descriptions in hover tooltip UI.');

  const modeGlyph = fs.readFileSync(path.join(repoRoot, 'src/renderer/ui/ModeGlyph.tsx'), 'utf8');
  assert(modeGlyph.includes('FALLBACK_MODE_CONFIG'), 'ModeGlyph should provide a safe fallback for custom Agent profiles.');

  const composerSendHelpers = fs.readFileSync(path.join(repoRoot, 'src/renderer/features/debugger/composer/composerSendHelpers.ts'), 'utf8');
  assert(composerSendHelpers.includes("return EXECUTABLE_APP_MODES.has(mode) ? mode as AppMode : 'edit';"), 'Composer send should not map custom profiles to Ask mode.');
  const composerSendFlow = fs.readFileSync(path.join(repoRoot, 'src/renderer/features/debugger/composer/composerSendFlow.ts'), 'utf8');
  assert(composerSendFlow.includes('agentId: selectedAgentId || null'), 'Conversation sends should freeze the selected Agent id.');
  assert(composerSendFlow.includes('setPromptValue(sentPrompt)') && composerSendFlow.includes('setPendingAttachments(sentAttachments)'), 'Local preflight failures should restore the Composer snapshot.');
  assert(!composerSendFlow.includes('setSelectedAgentId'), 'Local send failures must not rewrite the selected Agent id.');

  const handoffActions = fs.readFileSync(path.join(repoRoot, 'src/renderer/features/debugger/AgentChat/useAgentHandoffActions.ts'), 'utf8');
  assert(handoffActions.includes(": 'edit';"), 'Handoff to a custom Agent should keep the custom agentId with a generic executable mode.');

  const useSettingsModal = fs.readFileSync(path.join(repoRoot, 'src/renderer/features/settings/SettingsModal/useSettingsModal.ts'), 'utf8');
  assert(!useSettingsModal.includes('AGENT_ROLES'), 'Settings route validation should derive agents from manifest drafts.');
  assert(useSettingsModal.includes('useAgentManifestAutosave'), 'Settings should persist manifest drafts through the scoped autosave path.');
  assert(useSettingsModal.includes('saveAgentDefinition'), 'Settings should use the scoped Agent definition save service.');

  const agentManifestAutosave = fs.readFileSync(path.join(repoRoot, 'src/renderer/features/settings/SettingsModal/useAgentManifestAutosave.ts'), 'utf8');
  assert(agentManifestAutosave.includes('getChangedAgentManifestDrafts'), 'Agent autosave should write only changed manifest drafts.');
  assert(agentManifestAutosave.includes('latestRevisionRef'), 'Agent autosave should reject stale save completions by revision.');

  const settingsModalActions = fs.readFileSync(path.join(repoRoot, 'src/renderer/features/settings/SettingsModal/settingsModalActions.ts'), 'utf8');
  assert(!settingsModalActions.includes('AGENT_ROLES'), 'Settings route save should not be limited to built-in Agent roles.');
  assert(settingsModalActions.includes('agentManifestDrafts'), 'Settings route save should include custom manifest drafts.');
  assert(settingsModalActions.includes('saveAgentDefinition'), 'Settings route save should not rebuild the whole settings/workspace state.');

  const agentManifestServiceSource = fs.readFileSync(path.join(repoRoot, 'src/main/settings/AgentManifestService.ts'), 'utf8');
  assert(!agentManifestServiceSource.includes('Only top-level agent manifests'), 'Agent manifest import should not reject safe custom profiles.');
  assert(agentManifestServiceSource.includes('isSafeAgentProfileId(idFromFileName(entry))'), 'Agent manifest load should accept safe custom profile file ids.');
  assert(agentManifestServiceSource.includes('const routeAgentIds = new Set<string>(AGENT_ROLES)'), 'Agent manifest routes should seed built-ins before adding custom profiles.');
  assert(agentManifestServiceSource.includes('routeAgentIds.add(definition.id)'), 'Agent manifest routes should add custom profile ids.');

  const settingsServiceSource = fs.readFileSync(path.join(repoRoot, 'src/main/settings/SettingsService.ts'), 'utf8');
  assert(!settingsServiceSource.includes('KNOWN_AGENT_IDS'), 'Settings route normalization should not use a built-in Agent allowlist.');
  assert(settingsServiceSource.includes('isSafeAgentProfileId(route.agentId)'), 'Settings route normalization should validate safe custom profile ids.');
  assert(settingsServiceSource.includes('routeMap.set(route.agentId, route)'), 'Settings route normalization should preserve custom route ids.');
  assert(!settingsServiceSource.includes('agentRoutes?: LlmAgentRoute[];'), 'Persisted settings must not mirror Agent routes.');
  assert(settingsServiceSource.includes('routesFromDefinitions(createEmptyAgentRoutes(), baseAgentSettings.definitions)'), 'Runtime Agent routes must derive from .agent.md definitions.');

  const conversationServiceSource = fs.readFileSync(path.join(repoRoot, 'src/main/conversation/ConversationService.ts'), 'utf8');
  assert(conversationServiceSource.includes('resolveEnabledAgentDefinition'), 'Conversation routing should resolve enabled manifest definitions.');
  assert(!conversationServiceSource.includes('KNOWN_CONVERSATION_AGENTS'), 'Conversation routing should not be limited to built-in Agent roles.');

  const orchestratorSource = fs.readFileSync(path.join(repoRoot, 'src/main/workflow/debugger/AgentOrchestrator.ts'), 'utf8');
  assert(orchestratorSource.includes('getOrCreateAgentConfig'), 'Agent orchestrator should lazily initialize custom Agent config.');
  assert(orchestratorSource.includes("isTopLevelAgentId(agentId) ? agentId : 'edit'"), 'Custom Agent fallback config should use a generic profile default.');

  const runtimePolicySource = fs.readFileSync(path.join(repoRoot, 'src/main/workflow/debugger/DebuggerRuntimePolicy.ts'), 'utf8');
  assert(runtimePolicySource.includes('manifest.tools.flatMap'), 'Runtime tool policy should derive manifest tool allowlists directly.');
  assert(runtimePolicySource.includes('isTopLevelAgentId(agentId)'), 'Runtime tool policy should only grant executable defaults to built-in Agents.');

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
    await manifestService.saveDefinition({ agentsPath, instructionsPath }, agentDraft({
      id: savedAgentId,
      fileName: 'wrong-file-name.agent.md',
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

  console.log('[settings-agents] OK');
}

try {
  await main();
} catch (error) {
  console.error('[settings-agents] FAILED');
  console.error(error);
  process.exitCode = 1;
}

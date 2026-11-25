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
const { AgentManifestService } = require('../src/main/settings/agent-manifests/AgentManifestService.ts');
const {
  RESERVED_AGENT_IDS,
  isReservedAgentId,
} = require('../src/main/settings/settings-core/reservedAgentIds.ts');
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
  fs.writeFileSync(filePath, `---
name: ${options.name ?? 'Custom Browser Use Agent'}
description: ${options.description ?? 'A custom user-invocable profile for regression checks.'}
argument-hint: Describe the custom browser-use task
target: rdc-agent
icon: spark
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
    path.join(repoRoot, 'src/renderer/lib/settingsSections.ts'),
    'utf8',
  );
  const settingsModalCss = scriptReadCssBundle(
    'src/renderer/features/settings/SettingsModal/SettingsModal.css',
  );
  const skillsAgentsWrapperPath = path.join(repoRoot, 'src/renderer/features/settings/SettingsModal/sections/SkillsAgentsSettings.tsx');
  assert(!existsSrc(skillsAgentsWrapperPath), 'Skills and Agents settings must not keep the combined wrapper component.');
  assert(!settingsModalTypes.includes("'diagnostics'"), 'Settings sections must not restore Diagnostics navigation.');
  assert(!settingsModalTypes.includes('skillsAgents'), 'Settings sections must not expose the old Skills & Agents combined page.');
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
  assert(isReservedAgentId('ask') && isReservedAgentId('plan') && isReservedAgentId('edit'), 'ask/plan/edit must remain reserved ids.');
  assert(isReservedAgentId('ask_agent') && isReservedAgentId('triage-agent'), 'Old specialist aliases must remain reserved.');
  assert(!isReservedAgentId('general') && !isReservedAgentId('debugger'), 'Four builtins must not be reserved.');
  assert(RESERVED_AGENT_IDS.has('rdc-debugger'), 'Reserved set must include old specialist ids.');
  assert(!agentsSettings.includes('settings.patterns'), 'Agents settings must not expose internal pattern configuration.');
  assert(!agentsSettings.includes('rdcCliInvoker'), 'Agents settings must not expose the internal CLI invoker name.');
  const modelCascade = readSrcFile(
    path.join(repoRoot, 'src/renderer/features/settings/SettingsModal/sections/AgentModelCascadeSelect.tsx'),
    'utf8',
  );
  assert(!modelCascade.includes('splitCanonicalAgentModelId'), 'Model cascade must not synthesize missing selector options from persisted canonical ids.');
  assert(!modelCascade.includes('閫'), 'Model cascade must not hardcode mojibake text.');
  const toolsSettings = readSrcFile(
    path.join(repoRoot, 'src/renderer/features/settings/SettingsModal/sections/ToolsSettings.tsx'),
    'utf8',
  );
  assert(!toolsSettings.includes('onUpsertMcpServer'), 'Tools settings must not keep the removed Settings-owned MCP write path.');
  const renderDocToolchain = readSrcFile(
    path.join(repoRoot, 'src/renderer/features/settings/SettingsModal/sections/RdcCliInvokerSettingsFields.tsx'), 'utf8',
  );
  assert(!toolsSettings.includes('RdcActionsFields') && !renderDocToolchain.includes('catalogPath')
    && !renderDocToolchain.includes('jsonMode'), 'Settings must not restore lifecycle command templates or separate catalog/JSON modes.');

  const composer = readSrcFile(path.join(repoRoot, 'src/renderer/features/composer/Composer.tsx'), 'utf8');
  assert(!composer.includes('AGENT_MODES.map'), 'Composer should not hardcode mode entries as Agent choices.');
  const capabilityHook = readSrcFile(
    path.join(repoRoot, 'src/renderer/features/composer/useEffectiveModelCapability.ts'),
    'utf8',
  );
  const turnControls = readSrcFile(
    path.join(repoRoot, 'src/renderer/features/composer/useTurnControls.ts'),
    'utf8',
  );
  assert(!capabilityHook.includes('syncing-route') && !capabilityHook.includes('routeSyncState'),
    'Agent routes come from Settings → Agents; manifest saves never move them, so the Composer keeps no route-sync state.');
  assert(!capabilityHook.includes('catch {'), 'Capability request failures must not be swallowed by an empty catch.');
  assert(!turnControls.includes(':pending'), 'Turn controls must not retain the legacy pending capability-key sentinel.');
  const composerSendFlow = readSrcFile(path.join(repoRoot, 'src/renderer/features/composer/composerSendFlow.ts'), 'utf8');
  assert(!composerSendFlow.includes('setSelectedAgentId'), 'Local send failures must not rewrite the selected Agent id.');

  assert(!existsSrc(path.join(repoRoot, 'src/renderer/features/transcript/useAgentHandoffActions.ts')), 'Dead renderer handoff actions must be deleted.');
  assert(!fs.existsSync(path.join(repoRoot, 'src/shared/types/profileHandoff.ts')), 'Durable ProfileHandoffState must stay deleted.');
  assert(!fs.existsSync(path.join(repoRoot, 'src/main/sessions/HandoffStateStore.ts')), 'HandoffStateStore must stay deleted.');
  assert(!fs.existsSync(path.join(repoRoot, 'src/main/agent-runtime/agent/HandoffController.ts')), 'HandoffController must stay deleted.');
  const conversationService = readSrcFile(path.join(repoRoot, 'src/main/conversation/ConversationService.ts'), 'utf8');
  assert(!conversationService.includes('pendingHandoffs'), 'ConversationService must not keep an in-memory pendingHandoffs map.');
  assert(!conversationService.includes('scheduleHandoffAutoSend'), 'ConversationService must not auto-send declared continues.');

  const useSettingsModal = readSrcFile(path.join(repoRoot, 'src/renderer/features/settings/SettingsModal/useSettingsModal.ts'), 'utf8');
  assert(!useSettingsModal.includes('AGENT_ROLES'), 'Settings route validation should derive agents from manifest drafts.');

  const settingsModalActions = readSrcFile(path.join(repoRoot, 'src/renderer/features/settings/SettingsModal/settingsModalActions.ts'), 'utf8');
  assert(!settingsModalActions.includes('AGENT_ROLES'), 'Settings route save should not be limited to built-in Agent roles.');

  const agentManifestServiceSource = readSrcFile(path.join(repoRoot, 'src/main/settings/agent-manifests/AgentManifestService.ts'), 'utf8');
  assert(!agentManifestServiceSource.includes('Only top-level agent manifests'), 'Agent manifest import should not reject safe custom profiles.');

  const settingsServiceSource = readSrcFile(path.join(repoRoot, 'src/main/settings/settings-core/SettingsService.ts'), 'utf8');
  const settingsProviderSanitizeSource = readSrcFile(
    path.join(repoRoot, 'src/main/settings/settings-core/settingsProviderSanitize.ts'),
    'utf8',
  );
  assert(!settingsProviderSanitizeSource.includes('KNOWN_AGENT_IDS'), 'Settings route normalization should not use a built-in Agent allowlist.');
  assert(!settingsServiceSource.includes('agentRoutes?: LlmAgentRoute[];'), 'Persisted settings must not mirror Agent routes.');

  const conversationRoutePreflightSource = readSrcFile(
    path.join(repoRoot, 'src/main/conversation/ConversationRoutePreflight.ts'),
    'utf8',
  );
  assert(!conversationRoutePreflightSource.includes('KNOWN_CONVERSATION_AGENTS'), 'Conversation routing should not be limited to built-in Agent roles.');
  const { AgentSlotRegistry } = require('../src/main/agent-runtime/orchestration/AgentSlotRegistry.ts');
  const slots = new AgentSlotRegistry();
  slots.initializeDefaults();
  slots.configureAgent('general', { modelProvider: 'general-provider', modelName: 'general-model' });
  const customConfig = slots.getOrCreateAgentConfig(customAgentId);
  assert(customConfig.agentId === customAgentId, 'Custom Agent config must preserve its own id.');
  assert(customConfig.modelProvider === '' && customConfig.modelName === '', 'A missing custom route must not inherit General or a default model.');
  slots.applyLlmConfig([route(customAgentId, 'ollama', 'llama3')]);
  assert(slots.getAgentConfig(customAgentId)?.modelProvider === 'ollama'
    && slots.getAgentConfig(customAgentId)?.modelName === 'llama3', 'Custom Agent config must use its explicit compiled route.');
  slots.applyLlmConfig([]);
  assert(slots.getAgentConfig(customAgentId)?.modelProvider === ''
    && slots.getAgentConfig(customAgentId)?.modelName === '', 'Removing a compiled route must leave the custom Agent unconfigured.');

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-agent-settings-agents-'));
  try {
    const agentsPath = path.join(tempRoot, 'agents');
    const instructionsPath = path.join(tempRoot, 'RDC.md');
    fs.mkdirSync(agentsPath, { recursive: true });
    const customManifestPath = path.join(agentsPath, `${customAgentId}.agent.md`);
    writeCustomManifest(customManifestPath);

    const manifestService = new AgentManifestService();
    manifestService.bindAgentModelSettings(() => ({
      default: {},
      byAgent: {
        [customAgentId]: { model: canonicalAgentModelId('ollama', 'llama3') },
        'custom-invalid-route-agent': { model: canonicalAgentModelId('ollama', 'missing-model') },
      },
    }));
    const manifestSettings = manifestService.getSettings({ agentsPath, instructionsPath }, [ollama], validRoutes);
    const customDefinition = manifestSettings.definitions.find((definition) => definition.id === customAgentId);
    assert(customDefinition, 'Agent manifest settings should load a safe custom .agent.md profile.');
    assert(customDefinition.userInvocable === true, 'Custom profile should preserve user-invocable status.');
    assert(customDefinition.tools.includes('read') && customDefinition.tools.includes('search'), 'Custom profile should preserve declared tools.');
    assert(customDefinition.handoffs.some((handoff) => handoff.agent === 'edit'), 'Custom profile should preserve handoff definitions.');

    const routeSettings = manifestService.routesFromDefinitions(validRoutes, manifestSettings.definitions);
    const customRoute = routeSettings.find((entry) => entry.agentId === customAgentId);
    assert(customRoute?.providerId === 'ollama' && customRoute.modelId === 'llama3', 'A custom Agent route must come from its Settings → Agents model.');
    for (const agentId of AGENT_ROLES) {
      assert(routeSettings.some((entry) => entry.agentId === agentId), `Routes should retain built-in Agent route ${agentId}.`);
    }

    const savedAgentId = 'custom-saved-agent';
    let mismatchRejected = false;
    try {
      await manifestService.saveDefinition({ agentsPath, instructionsPath }, agentDraft({
        id: savedAgentId,
        fileName: 'wrong-file-name.agent.md',
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
    }));
    manifestService.saveGlobalInstructions({ instructionsPath }, 'global custom instructions');
    assert(fs.existsSync(path.join(agentsPath, `${savedAgentId}.agent.md`)), 'Saving a custom profile should write a safe id-based file name.');
    const savedSettings = manifestService.getSettings({ agentsPath, instructionsPath }, [ollama], validRoutes);
    assert(savedSettings.definitions.some((definition) => definition.id === savedAgentId), 'Saved custom profile should reload by custom id.');

    const invalidRouteSettings = manifestService.routesFromDefinitions([], [
      agentDraft({ id: 'custom-invalid-route-agent' }),
    ]);
    const invalidRoute = invalidRouteSettings.find((entry) => entry.agentId === 'custom-invalid-route-agent');
    assert(
      invalidRoute?.providerId === 'ollama' && invalidRoute.modelId === 'missing-model',
      'Settings must preserve an explicit route; EffectiveCatalog rejects unavailable models at execution time.',
    );

    const importPath = path.join(tempRoot, 'custom-imported-agent.agent.md');
    writeCustomManifest(importPath, { name: 'Custom Imported Agent' });

    const movedFieldPath = path.join(agentsPath, 'custom-moved-field-agent.agent.md');
    fs.writeFileSync(movedFieldPath, fs.readFileSync(importPath, 'utf8').replace('icon: spark', 'model: [ollama:llama3]\nicon: spark'));
    const movedFieldSettings = manifestService.getSettings({ agentsPath, instructionsPath }, [ollama], validRoutes);
    assert(movedFieldSettings.diagnostics.some((issue) => issue.code === 'AGENT_MANIFEST_FIELD_MOVED' && issue.sourcePath === movedFieldPath),
      'A manifest that still declares a model must stay inactive with a migratable diagnostic.');
    fs.rmSync(movedFieldPath);
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
    const reservedUserBytes = fs.readFileSync(path.join(agentsPath, 'plan.agent.md'));

    const projectRoot = path.join(tempRoot, 'project');
    const projectAgents = path.join(projectRoot, '.rdc-agent', 'agents');
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
        entry.code === 'AGENT_ID_RESERVED_HISTORICAL' && entry.scope === 'user' && entry.agentId === 'ask'
      )),
      'User reserved historical ids must emit AGENT_ID_RESERVED_HISTORICAL.',
    );
    assert(
      reservedSettings.diagnostics.some((entry) => (
        entry.code === 'AGENT_ID_RESERVED_HISTORICAL' && entry.scope === 'project'
      )),
      'Project reserved historical ids must emit AGENT_ID_RESERVED_HISTORICAL.',
    );
    assert(fs.existsSync(path.join(projectAgents, 'edit.agent.md')), 'Project reserved files must not be auto-deleted.');
    assert(fs.existsSync(path.join(projectAgents, 'ask.agent.md')), 'Project reserved files must remain on disk.');
    assert(fs.readFileSync(path.join(agentsPath, 'plan.agent.md')).equals(reservedUserBytes), 'Snapshot resolution must not mutate a reserved user file.');
    assert(!fs.existsSync(path.join(agentsPath, '.seed-migration.json')), 'Snapshot resolution must not create a migration marker.');
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
  assert(!agentEditorSource.includes('settings-agent-accent-field'), 'Agents must not keep the legacy toolbar accent field markup');
  assert(!agentEditorSource.includes('settings-agent-identity-controls'), 'legacy stacked identity-controls row must be removed');
  assert(!agentEditorSource.includes('settings-agent-look-strip'), 'legacy look strip must be removed from the route panel');
  assert(!settingsModalCss.includes('.settings-agent-accent-field'), 'legacy Agents accent CSS must be removed');
  assert(!settingsModalCss.includes('.settings-agent-accent-hex'), 'legacy Agents accent hex CSS must be removed');
  assert(!settingsModalCss.includes('.settings-agent-look-strip'), 'legacy Agents look strip CSS must be removed');
  assert(
    !agentEditorSource.includes('settings-agent-editor-id') && !agentEditorSource.includes('modelSourceLabel'),
    'Agent editor header shows the name and description only: no agent id and no duplicate model-source line',
  );

  console.log('[settings-agents] OK');
}

try {
  await main();
} catch (error) {
  console.error('[settings-agents] FAILED');
  console.error(error);
  throw error;
}

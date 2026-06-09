import { createRequire } from 'module';

const require = createRequire(import.meta.url);
require('./register-ts-source.cjs');

const { AGENT_ROLES } = require('../src/shared/constants/agents.ts');
const { createBuiltinProviderEntry } = require('../src/shared/constants/llm.ts');
const { resolveCompatibleAgentRoute } = require('../src/main/settings/LlmRouteCompatibility.ts');
const { resolveAgentRouteStatus } = require('../src/renderer/features/settings/SettingsModal/agentRouteStatus.ts');
const {
  canonicalAgentModelId,
  splitCanonicalAgentModelId,
} = require('../src/shared/utils/agentModelRoute.ts');
const fs = require('node:fs');
const path = require('node:path');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function configuredProvider(id, modelIds) {
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

function route(agentId, providerId, modelId) {
  return { agentId, providerId, modelId };
}

function main() {
  const ollama = configuredProvider('ollama', ['llama3']);
  const validRoutes = AGENT_ROLES.map((agentId) => route(agentId, 'ollama', 'llama3'));

  for (const agentRoute of validRoutes) {
    const status = resolveAgentRouteStatus(agentRoute, [ollama]);
    assert(status.issue === null, `${agentRoute.agentId} valid route should not report an issue.`);
    assert(status.provider?.id === 'ollama', `${agentRoute.agentId} should resolve the configured provider.`);
    assert(status.availableModels.length === 1, `${agentRoute.agentId} should expose enabled models.`);
  }

  const invalidModel = resolveAgentRouteStatus(route('debugger', 'ollama', 'missing-model'), [ollama]);
  assert(invalidModel.issue === 'settings.routeReasonModelInvalid', 'Missing model should be reported as an invalid route.');

  const unavailableProvider = {
    ...ollama,
    enabled: false,
    isConfigured: false,
  };
  const unavailable = resolveAgentRouteStatus(route('debugger', 'ollama', 'llama3'), [unavailableProvider]);
  assert(unavailable.issue === 'settings.routeReasonProviderUnavailable', 'Disabled provider should be reported as unavailable.');

  const copilot = configuredProvider('github-copilot', ['gpt-4.1', 'gpt-5.4']);
  const copilotRoutes = [
    route('debugger', 'github-copilot', 'gpt-4.1'),
    route('ask', 'github-copilot', 'gpt-5.4'),
  ];
  const remapped = resolveCompatibleAgentRoute(copilotRoutes, [copilot], 'ask');
  assert(remapped.provider?.id === 'github-copilot', 'Copilot route should resolve provider.');
  assert(remapped.requestedModelId === 'gpt-5.4', 'Copilot remap should preserve requested model.');
  assert(remapped.route?.modelId === 'gpt-4.1', 'Copilot unsupported model should remap to a supported chat completions model.');
  assert(Boolean(remapped.remapReason), 'Copilot remap should include a diagnostic reason.');

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

  const toolsSettings = fs.readFileSync(
    path.join(repoRoot, 'src/renderer/features/settings/SettingsModal/sections/SkillsToolsSettings.tsx'),
    'utf8',
  );
  assert(toolsSettings.includes('settings.globalInstructions'), 'Skills & Tools should expose global instructions.');
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

  console.log('[settings-agents] OK');
}

try {
  main();
} catch (error) {
  console.error('[settings-agents] FAILED');
  console.error(error);
  process.exitCode = 1;
}

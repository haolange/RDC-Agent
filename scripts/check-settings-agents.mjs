import { createRequire } from 'module';

const require = createRequire(import.meta.url);
require('./register-ts-source.cjs');

const { AGENT_ROLES } = require('../src/shared/constants/agents.ts');
const { createBuiltinProviderEntry } = require('../src/shared/constants/llm.ts');
const { resolveCompatibleAgentRoute } = require('../src/main/settings/LlmRouteCompatibility.ts');
const { resolveAgentRouteStatus } = require('../src/renderer/features/settings/SettingsModal/agentRouteStatus.ts');

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

  const invalidModel = resolveAgentRouteStatus(route('rdc-debugger', 'ollama', 'missing-model'), [ollama]);
  assert(invalidModel.issue === 'settings.routeReasonModelInvalid', 'Missing model should be reported as an invalid route.');

  const unavailableProvider = {
    ...ollama,
    enabled: false,
    isConfigured: false,
  };
  const unavailable = resolveAgentRouteStatus(route('rdc-debugger', 'ollama', 'llama3'), [unavailableProvider]);
  assert(unavailable.issue === 'settings.routeReasonProviderUnavailable', 'Disabled provider should be reported as unavailable.');

  const copilot = configuredProvider('github-copilot', ['gpt-4.1', 'gpt-5.4']);
  const copilotRoutes = [
    route('rdc-debugger', 'github-copilot', 'gpt-4.1'),
    route('ask_agent', 'github-copilot', 'gpt-5.4'),
  ];
  const remapped = resolveCompatibleAgentRoute(copilotRoutes, [copilot], 'ask_agent');
  assert(remapped.provider?.id === 'github-copilot', 'Copilot route should resolve provider.');
  assert(remapped.requestedModelId === 'gpt-5.4', 'Copilot remap should preserve requested model.');
  assert(remapped.route?.modelId === 'gpt-4.1', 'Copilot unsupported model should remap to a supported chat completions model.');
  assert(Boolean(remapped.remapReason), 'Copilot remap should include a diagnostic reason.');

  console.log('[settings-agents] OK');
}

try {
  main();
} catch (error) {
  console.error('[settings-agents] FAILED');
  console.error(error);
  process.exitCode = 1;
}


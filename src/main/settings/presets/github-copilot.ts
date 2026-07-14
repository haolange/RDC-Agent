import type { ProviderPreset } from '@shared/types/providerCapability';

const preset: ProviderPreset = {
  schemaVersion: 1,
  id: 'github-copilot',
  vendorId: 'github',
  label: 'GitHub Copilot',
  status: 'stable',
  availability: { state: 'unknown' },
  category: 'login-authorization',
  catalogOwnership: 'app-managed',
  authModes: ['oauth'],
  accountLoginConfigured: true,
  capabilities: ['chat', 'tool-calling', 'model-discovery'],
  routes: [{
    protocol: 'OpenAICompatibleChatCompletions',
    baseUrl: '',
    default: true,
  }],
  userSelectableRoute: false,
  discovery: {
    kind: 'custom-parser',
    parserId: 'account-catalog',
  },
  seedModels: [],
  overlays: [{
    modelId: 'gemini-3.1-pro-preview',
    patch: {
      contextTiers: [{
        id: 'long_context',
        label: '1M context',
        maxPromptTokens: 922_000,
        maxOutputTokens: 128_000,
        maxTotalTokens: 1_050_000,
        activation: { kind: 'implicit' },
        entitlement: 'unknown',
      }],
    },
  }],
  recommendedModels: [],
  docsUrl: 'https://github.com/features/copilot',
};

export default preset;

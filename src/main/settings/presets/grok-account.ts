import type { ProviderPreset } from '@shared/types/providerCapability';

const preset: ProviderPreset = {
  schemaVersion: 1,
  id: 'grok-account',
  vendorId: 'xai',
  label: 'Super Grok Account',
  status: 'beta',
  availability: { state: 'available' },
  category: 'login-authorization',
  catalogOwnership: 'app-managed',
  authModes: ['oauth'],
  accountLoginConfigured: true,
  capabilities: ['chat', 'tool-calling', 'vision-input', 'model-discovery'],
  routes: [{ protocol: 'OpenAIResponses', baseUrl: 'https://cli-chat-proxy.grok.com/v1', default: true }],
  userSelectableRoute: false,
  discovery: { kind: 'custom-parser', parserId: 'grok-account-catalog' },
  seedModels: [],
  overlays: [
    {
      modelId: 'grok-4.20-0309-non-reasoning',
      patch: {
        contextTiers: [{
          id: 'default', label: '1M window', maxTotalTokens: 1_000_000,
          activation: { kind: 'implicit' }, entitlement: 'granted',
        }],
        defaultBudgetTokens: 200_000,
      },
    },
    {
      modelId: 'grok-4.20-0309-reasoning',
      patch: {
        contextTiers: [{
          id: 'default', label: '1M window', maxTotalTokens: 1_000_000,
          activation: { kind: 'implicit' }, entitlement: 'granted',
        }],
        defaultBudgetTokens: 200_000,
      },
    },
    {
      modelId: 'grok-4.5',
      patch: {
        contextTiers: [{
          id: 'default', label: '500K window', maxTotalTokens: 500_000,
          activation: { kind: 'implicit' }, entitlement: 'granted',
        }],
        defaultBudgetTokens: 500_000,
        reasoning: {
          kind: 'levels', supportsOff: false, levels: ['low', 'medium', 'high'], defaultSelection: 'medium',
          wireProfile: {
            kind: 'openai-responses', on: 'medium',
            levels: { low: 'low', medium: 'medium', high: 'high' },
          },
        },
      },
    },
  ],
  recommendedModels: [],
  docsUrl: 'https://grok.com/',
};

export default preset;

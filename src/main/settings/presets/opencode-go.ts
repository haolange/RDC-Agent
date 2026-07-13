import type { ProviderPreset } from '@shared/types/providerCapability';

const preset: ProviderPreset = {
  schemaVersion: 1,
  id: 'opencode-go',
  vendorId: 'opencode',
  label: 'OpenCode Go',
  status: 'beta',
  availability: { state: 'unknown', reason: 'TODO(live-verify): verify the account catalog and each model-level route.' },
  category: 'third-party-compatible',
  catalogOwnership: 'user-managed',
  authModes: ['api-key'],
  capabilities: ['chat', 'tool-calling', 'model-discovery'],
  routes: [
    { protocol: 'OpenAICompatibleChatCompletions', baseUrl: 'https://opencode.ai/zen/go/v1', default: true },
    { protocol: 'OpenAIResponses', baseUrl: 'https://opencode.ai/zen/go/v1' },
    { protocol: 'AnthropicMessages', baseUrl: 'https://opencode.ai/zen/go/v1' },
  ],
  userSelectableRoute: false,
  discovery: { kind: 'custom-parser', parserId: 'opencode-go-catalog' },
  seedModels: [],
  overlays: [],
  recommendedModels: [],
  docsUrl: 'https://opencode.ai/docs/go/',
};

export default preset;

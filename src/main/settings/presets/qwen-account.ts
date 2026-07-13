import type { ProviderPreset } from '@shared/types/providerCapability';

const preset: ProviderPreset = {
  schemaVersion: 1,
  id: 'qwen-account',
  vendorId: 'alibaba',
  label: 'Qwen Account',
  status: 'beta',
  availability: { state: 'unavailable', reason: 'TODO(live-verify): no stable public Qwen account OAuth contract; no flow is registered.' },
  category: 'login-authorization',
  catalogOwnership: 'user-managed',
  authModes: ['oauth'],
  authModeAvailability: { oauth: { state: 'unavailable', reason: 'No public contract.' } },
  accountLoginConfigured: false,
  capabilities: ['chat', 'tool-calling'],
  routes: [{ protocol: 'OpenAICompatibleChatCompletions', baseUrl: 'https://portal.qwen.ai/v1', default: true }],
  userSelectableRoute: false,
  discovery: null,
  seedModels: [],
  overlays: [],
  recommendedModels: [],
  docsUrl: 'https://qwen.ai/',
};

export default preset;

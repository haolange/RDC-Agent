import type { ProviderPreset } from '@shared/types/providerCapability';

const preset: ProviderPreset = {
  schemaVersion: 1,
  id: 'grok-account',
  vendorId: 'xai',
  label: 'Super Grok Account',
  status: 'stable',
  availability: { state: 'unknown' },
  category: 'login-authorization',
  catalogOwnership: 'app-managed',
  authModes: ['oauth'],
  accountLoginConfigured: true,
  capabilities: ['chat', 'tool-calling', 'vision-input', 'model-discovery'],
  routes: [{ protocol: 'OpenAIResponses', baseUrl: 'https://cli-chat-proxy.grok.com/v1', default: true }],
  userSelectableRoute: false,
  discovery: { kind: 'custom-parser', parserId: 'grok-account-catalog' },
  seedModels: [],
  overlays: [],
  recommendedModels: [],
  docsUrl: 'https://grok.com/',
};

export default preset;

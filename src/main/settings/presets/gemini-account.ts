import type { ProviderPreset } from '@shared/types/providerCapability';

const preset: ProviderPreset = {
  schemaVersion: 1,
  id: 'gemini-account',
  vendorId: 'google',
  label: 'Gemini Account',
  status: 'beta',
  availability: { state: 'unavailable', reason: 'TODO(live-verify): no stable public Gemini account OAuth contract; no flow is registered.' },
  category: 'login-authorization',
  catalogOwnership: 'user-managed',
  authModes: ['oauth'],
  authModeAvailability: { oauth: { state: 'unavailable', reason: 'No public contract.' } },
  accountLoginConfigured: false,
  capabilities: ['chat', 'tool-calling', 'reasoning', 'vision-input'],
  routes: [{ protocol: 'GoogleGemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', default: true }],
  userSelectableRoute: false,
  discovery: null,
  seedModels: [],
  overlays: [],
  recommendedModels: [],
  docsUrl: 'https://ai.google.dev/',
};

export default preset;

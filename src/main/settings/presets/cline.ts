import type { ProviderPreset } from '@shared/types/providerCapability';

const preset: ProviderPreset = {
  schemaVersion: 1,
  id: 'cline',
  vendorId: 'cline',
  label: 'Cline',
  status: 'beta',
  availability: { state: 'unknown' },
  category: 'third-party-compatible',
  catalogOwnership: 'user-managed',
  authModes: ['api-key', 'oauth'],
  authModeAvailability: {
    'api-key': { state: 'available' },
    oauth: { state: 'unavailable', reason: 'TODO(live-verify): Cline has no stable public OAuth endpoint/callback contract.' },
  },
  accountLoginConfigured: false,
  capabilities: ['chat', 'tool-calling', 'model-discovery'],
  routes: [{ protocol: 'OpenAICompatibleChatCompletions', baseUrl: 'https://api.cline.bot/api/v1', default: true }],
  userSelectableRoute: false,
  discovery: { kind: 'custom-parser', parserId: 'cline-catalog' },
  seedModels: [],
  overlays: [],
  recommendedModels: [],
  docsUrl: 'https://docs.cline.bot/cline-api',
};

export default preset;

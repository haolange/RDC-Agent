import type { ProviderPreset } from '@shared/types/providerCapability';

const preset: ProviderPreset = {
  schemaVersion: 1,
  id: 'iflow',
  vendorId: 'iflow',
  label: 'iFlow',
  status: 'beta',
  availability: {
    state: 'unavailable',
    reason: 'iFlow does not publish a stable LLM model catalog endpoint; configure it only after the public contract is documented.',
  },
  category: 'official-compatible',
  catalogOwnership: 'user-managed',
  authModes: ['api-key'],
  capabilities: ['chat'],
  routes: [{ protocol: 'OpenAICompatibleChatCompletions', baseUrl: '', default: true }],
  userSelectableRoute: false,
  discovery: null,
  seedModels: [],
  overlays: [],
  recommendedModels: [],
  docsUrl: 'https://platform.iflow.cn/docs/api-reference',
};

export default preset;

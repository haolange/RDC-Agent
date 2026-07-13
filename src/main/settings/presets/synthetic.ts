import type { ProviderPreset } from '@shared/types/providerCapability';

const preset: ProviderPreset = {
  schemaVersion: 1, id: 'synthetic', vendorId: 'synthetic', label: 'Synthetic', status: 'stable',
  availability: { state: 'unknown' }, category: 'third-party-compatible', catalogOwnership: 'user-managed',
  authModes: ['api-key'], capabilities: ['chat', 'tool-calling', 'model-discovery'],
  routes: [{ protocol: 'OpenAICompatibleChatCompletions', baseUrl: 'https://api.synthetic.new/openai/v1', default: true }],
  userSelectableRoute: false,
  discovery: { kind: 'json-catalog', path: '/models', collectionPath: '$', mapping: { id: 'id', label: 'name', contextWindow: 'context_length', modality: 'input_modalities' }, admission: { allowedModalities: ['text', 'image'] } },
  seedModels: [], overlays: [], recommendedModels: ['syn:large:text', 'syn:large:vision'],
  docsUrl: 'https://dev.synthetic.new/docs/openai/models',
};

export default preset;

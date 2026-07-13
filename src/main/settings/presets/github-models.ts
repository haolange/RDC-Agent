import type { ProviderPreset } from '@shared/types/providerCapability';

const preset: ProviderPreset = {
  schemaVersion: 1, id: 'github-models', vendorId: 'github', label: 'GitHub Models', status: 'stable',
  availability: { state: 'unknown' }, category: 'official-compatible', catalogOwnership: 'user-managed',
  authModes: ['api-key'], capabilities: ['chat', 'tool-calling', 'vision-input', 'model-discovery'],
  routes: [{
    protocol: 'OpenAICompatibleChatCompletions', baseUrl: 'https://models.github.ai/inference', default: true,
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  }],
  userSelectableRoute: false,
  discovery: {
    kind: 'json-catalog', url: 'https://models.github.ai/catalog/models', collectionPath: '$',
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    mapping: { id: 'id', label: 'name', modality: 'capabilities.input_modalities' },
    admission: { allowedModalities: ['text', 'image'], denyPatterns: ['*embed*', '*rerank*'] },
  },
  seedModels: [], overlays: [], recommendedModels: ['openai/gpt-4.1', 'meta/llama-4-maverick-17b-128e-instruct-fp8'],
  docsUrl: 'https://docs.github.com/en/rest/models',
};

export default preset;

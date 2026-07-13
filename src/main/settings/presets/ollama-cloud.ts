import type { ProviderPreset } from '@shared/types/providerCapability';

const preset: ProviderPreset = {
  schemaVersion: 1, id: 'ollama-cloud', vendorId: 'ollama', label: 'Ollama Cloud', status: 'stable',
  availability: { state: 'unknown' }, category: 'official-compatible', catalogOwnership: 'user-managed',
  authModes: ['api-key'], capabilities: ['chat', 'tool-calling', 'model-discovery'],
  routes: [{ protocol: 'OllamaOpenAICompatibleChatCompletions', baseUrl: 'https://ollama.com', default: true }],
  userSelectableRoute: false,
  discovery: { kind: 'json-catalog', url: 'https://ollama.com/api/tags', collectionPath: 'models', mapping: { id: 'name', label: 'name' }, admission: { denyPatterns: ['*embed*'] } },
  seedModels: [], overlays: [], recommendedModels: ['gpt-oss:120b-cloud', 'deepseek-v3.1:671b-cloud'],
  docsUrl: 'https://docs.ollama.com/api/introduction',
};

export default preset;

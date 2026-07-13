import type { ProviderPreset } from '@shared/types/providerCapability';

const preset: ProviderPreset = {
  schemaVersion: 1, id: 'novita-ai', vendorId: 'novita', label: 'Novita AI', status: 'stable',
  availability: { state: 'unknown' }, category: 'third-party-compatible', catalogOwnership: 'user-managed',
  authModes: ['api-key'], capabilities: ['chat', 'tool-calling', 'structured-output', 'vision-input', 'model-discovery'],
  routes: [{ protocol: 'OpenAICompatibleChatCompletions', baseUrl: 'https://api.novita.ai/openai/v1', default: true }],
  userSelectableRoute: false,
  discovery: { kind: 'json-catalog', path: '/models', collectionPath: 'data', mapping: { id: 'id', label: 'title', contextWindow: 'context_size' }, admission: { denyPatterns: ['*embed*', '*bge*', '*rerank*'] } },
  seedModels: [], overlays: [], recommendedModels: ['deepseek/deepseek-r1', 'meta-llama/llama-3.3-70b-instruct'],
  docsUrl: 'https://novita.ai/docs/api-reference/model-apis-llm-list-models',
};

export default preset;

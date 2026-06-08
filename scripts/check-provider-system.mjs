import { createRequire } from 'module';

const require = createRequire(import.meta.url);
require('./register-ts-source.cjs');

const {
  BUILTIN_LLM_PROVIDER_DEFINITIONS,
} = require('../src/shared/constants/llm.ts');
const {
  normalizeProviderCatalogGroup,
} = require('../src/main/settings/providerCatalogGroup.ts');
const {
  MediaRuntimeService,
} = require('../src/main/settings/MediaRuntimeService.ts');

const VALID_CATALOG_GROUPS = [
  'account',
  'openai-compatible',
  'anthropic-compatible',
  'cloud-platform',
  'local',
  'image',
];

const VALID_KINDS = [
  'openrouter',
  'openai-compatible',
  'anthropic',
  'google-ai-studio',
  'azure-openai',
  'bedrock',
  'vertex',
  'ollama',
];

const VALID_AUTH_MODES = ['api-key', 'local', 'account', 'environment'];

const VALID_CAPABILITIES = [
  'chat',
  'tool-calling',
  'structured-output',
  'reasoning',
  'prompt-cache',
  'vision-input',
  'model-discovery',
  'image-generation',
  'video-generation',
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertIncludes(values, value, label) {
  assert(values.includes(value), `${label} is invalid: ${value}`);
}

async function main() {
  const ids = BUILTIN_LLM_PROVIDER_DEFINITIONS.map((definition) => definition.id);
  assert(new Set(ids).size === ids.length, 'Builtin provider ids must be unique.');
  for (const id of ['openai', 'anthropic', 'bedrock', 'vertex', 'ollama', 'chatgpt-account', 'claude-account']) {
    assert(ids.includes(id), `Builtin provider is missing: ${id}`);
  }

  for (const definition of BUILTIN_LLM_PROVIDER_DEFINITIONS) {
    assertIncludes(VALID_CATALOG_GROUPS, definition.catalogGroup, `${definition.id}.catalogGroup`);
    assertIncludes(VALID_KINDS, definition.kind, `${definition.id}.kind`);
    assertIncludes(VALID_AUTH_MODES, definition.authMode, `${definition.id}.authMode`);
    assert(Array.isArray(definition.capabilities), `${definition.id}.capabilities must be an array.`);
    assert(definition.capabilities.includes('chat'), `${definition.id}.capabilities must include chat.`);
    for (const capability of definition.capabilities) {
      assertIncludes(VALID_CAPABILITIES, capability, `${definition.id}.capability`);
    }

    if (definition.authMode === 'account') {
      assert(definition.catalogGroup === 'account', `${definition.id} account provider must use account group.`);
    }
    if (definition.authMode === 'environment') {
      assert(definition.catalogGroup === 'cloud-platform', `${definition.id} environment provider must use cloud-platform group.`);
    }
    if (definition.authMode === 'local') {
      assert(definition.catalogGroup === 'local', `${definition.id} local provider must use local group.`);
    }
    if (definition.modelDiscovery === 'static') {
      assert(!definition.capabilities.includes('model-discovery'), `${definition.id} static discovery must not claim model-discovery.`);
    }
  }

  assert(
    normalizeProviderCatalogGroup({ id: 'openai', catalogGroup: 'api-key', authMode: 'api-key' }) === 'openai-compatible',
    'openai legacy catalogGroup should migrate through builtin identity.',
  );
  assert(
    normalizeProviderCatalogGroup({ id: 'anthropic', catalogGroup: 'api-key', authMode: 'api-key' }) === 'anthropic-compatible',
    'anthropic legacy catalogGroup should migrate through builtin identity.',
  );
  assert(
    normalizeProviderCatalogGroup({ id: 'bedrock', catalogGroup: 'environment', authMode: 'environment' }) === 'cloud-platform',
    'bedrock legacy catalogGroup should migrate through builtin identity.',
  );
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => {
    warnings.push(args);
  };
  try {
    assert(
      normalizeProviderCatalogGroup({ id: 'custom-unknown', catalogGroup: 'api-key', authMode: 'api-key' }) === 'openai-compatible',
      'unknown api-key providers should fall back to openai-compatible.',
    );
  } finally {
    console.warn = originalWarn;
  }
  assert(warnings.length === 1, 'unknown provider fallback should emit one diagnostic warning.');

  const mediaRuntime = new MediaRuntimeService();
  const generationResult = await mediaRuntime.generate({
    providerId: 'openai',
    modelId: 'dall-e-3',
    prompt: 'contract check',
  });
  assert(generationResult.status === 'adapter-not-implemented', 'Media runtime must fail closed without an adapter.');
  assert(generationResult.error?.includes('not implemented'), 'Media runtime should explain missing adapter.');
  assert(mediaRuntime.isMediaAdapterAvailable('openai') === false, 'Media adapter discovery must report unavailable.');
  assert(mediaRuntime.getRegisteredMediaProviders().length === 0, 'No media providers should be registered yet.');

  console.log('[provider-system] OK');
}

main().catch((error) => {
  console.error('[provider-system] FAILED');
  console.error(error);
  process.exitCode = 1;
});

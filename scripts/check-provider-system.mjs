import { createRequire } from 'module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
require('./register-ts-source.cjs');

const llmConstants = require('../src/shared/constants/llm.ts');
const {
  BUILTIN_LLM_PROVIDER_DEFINITIONS,
  createBuiltinProviderEntries,
} = llmConstants;
const {
  MediaRuntimeService,
} = require('../src/main/settings/MediaRuntimeService.ts');

const EXPECTED_PROTOCOLS = [
  'OpenAICompatibleChatCompletions',
  'OpenAIResponses',
  'AnthropicMessages',
  'OpenRouterChatCompletions',
  'AzureOpenAIChatCompletions',
  'GoogleGemini',
  'AwsBedrock',
  'GoogleVertexAI',
  'OllamaOpenAICompatibleChatCompletions',
];

const LEGACY_UI_CATEGORIES = ['openai-compatible', 'anthropic-compatible', 'account', 'plan'];
const PLAN_PROVIDER_ID_PATTERN = /(?:coding-plan|token-plan)/u;

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

const CATALOG_SECRET_FIELDS = [
  'apiKey',
  'secretRef',
  'hasStoredSecret',
  'accessToken',
  'refreshToken',
  'oauthToken',
  'oauthSecret',
  'credential',
  'credentials',
  'password',
  'accountLabel',
  'planLabel',
  'oauthExpiresAt',
  'oauthRefreshAvailable',
  'lastTestedAt',
  'lastModelRefreshAt',
  'lastError',
];

const CATALOG_RUNTIME_FIELDS = [
  'enabled',
  'status',
  'isConfigured',
  'models',
  'modelDiscovery',
  'baseUrl',
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertIncludes(values, value, label) {
  assert(values.includes(value), `${label} is invalid: ${value}`);
}

function read(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function extractStringUnion(source, typeName) {
  const match = new RegExp(`export\\s+type\\s+${typeName}\\s*=([\\s\\S]*?);`, 'm').exec(source);
  assert(match, `src/shared/types/settings.ts must export ${typeName}.`);
  return Array.from(match[1].matchAll(/'([^']+)'/g), (entry) => entry[1]);
}

function extractInterfaceBody(source, interfaceName) {
  const match = new RegExp(`export\\s+interface\\s+${interfaceName}\\s*\\{([\\s\\S]*?)\\n\\}`, 'm').exec(source);
  assert(match, `src/shared/types/settings.ts must export interface ${interfaceName}.`);
  return match[1];
}

function extractExportedTypeDeclaration(source, typeName) {
  const typeMatch = new RegExp(`export\\s+type\\s+${typeName}\\s*=([\\s\\S]*?);`, 'm').exec(source);
  if (typeMatch) {
    return typeMatch[1];
  }
  return extractInterfaceBody(source, typeName);
}

function assertCatalogTypeOmitsSecrets(declaration) {
  if (/Omit\s*</u.test(declaration)) {
    for (const field of CATALOG_SECRET_FIELDS) {
      assert(declaration.includes(`'${field}'`), `LlmProviderCatalogEntry must omit ${field}.`);
    }
    return;
  }
  for (const field of CATALOG_SECRET_FIELDS) {
    assert(!new RegExp(`\\b${field}\\b`, 'u').test(declaration), `LlmProviderCatalogEntry must not expose ${field}.`);
  }
}

function assertNoForbiddenKeys(value, forbiddenKeys, label) {
  const queue = [{ value, path: label }];
  const forbidden = new Set(forbiddenKeys.map((key) => key.toLowerCase()));
  while (queue.length > 0) {
    const item = queue.shift();
    if (!item || item.value === null || typeof item.value !== 'object') {
      continue;
    }
    for (const [key, child] of Object.entries(item.value)) {
      assert(!forbidden.has(key.toLowerCase()), `${item.path}.${key} must not be present in provider catalog DTOs.`);
      if (child && typeof child === 'object') {
        queue.push({ value: child, path: `${item.path}.${key}` });
      }
    }
  }
}

function assertSourceDoesNotContain(source, forbiddenTokens, label) {
  for (const token of forbiddenTokens) {
    assert(!source.includes(token), `${label} must not contain ${token}.`);
  }
}

function assertSourceContains(source, requiredTokens, label) {
  for (const token of requiredTokens) {
    assert(source.includes(token), `${label} must contain ${token}.`);
  }
}

function loadProviderCatalog(runtimeEntries) {
  if (typeof llmConstants.createBuiltinProviderCatalogEntries === 'function') {
    return {
      providers: llmConstants.createBuiltinProviderCatalogEntries(),
      categories: [],
      protocols: [],
    };
  }

  const servicePath = path.join(process.cwd(), 'src/main/settings/ProviderCatalogService.ts');
  assert(fs.existsSync(servicePath), 'ProviderCatalogService.ts or createBuiltinProviderCatalogEntries() must provide catalog DTOs.');
  const { providerCatalogService } = require('../src/main/settings/ProviderCatalogService.ts');
  assert(providerCatalogService?.getProviderCatalog, 'ProviderCatalogService must expose getProviderCatalog().');
  return providerCatalogService.getProviderCatalog(runtimeEntries);
}

async function main() {
  const settingsTypes = read('src/shared/types/settings.ts');
  const categories = extractStringUnion(settingsTypes, 'LlmProviderCategory');
  assert(categories.length === 8, `LlmProviderCategory must expose exactly 8 UI categories, found ${categories.length}: ${categories.join(', ')}`);
  for (const legacyCategory of LEGACY_UI_CATEGORIES) {
    assert(!categories.includes(legacyCategory), `LlmProviderCategory must not expose legacy or unsplit UI category: ${legacyCategory}`);
  }
  assert(categories.includes('coding-token-plan'), 'LlmProviderCategory must include split coding-token-plan entries.');
  assert(categories.includes('login-authorization'), 'LlmProviderCategory must include login-authorization account entries.');

  const protocols = extractStringUnion(settingsTypes, 'LlmProviderProtocol');
  for (const protocol of EXPECTED_PROTOCOLS) {
    assertIncludes(protocols, protocol, 'LlmProviderProtocol');
  }

  const providerEntry = extractInterfaceBody(settingsTypes, 'LlmProviderEntry');
  assert(providerEntry.includes('protocol: LlmProviderProtocol'), 'LlmProviderEntry must expose protocol: LlmProviderProtocol.');
  assert(providerEntry.includes('category: LlmProviderCategory'), 'LlmProviderEntry must expose category: LlmProviderCategory.');
  assert(!providerEntry.includes('kind:'), 'LlmProviderEntry must not keep legacy kind field.');
  assert(!providerEntry.includes('catalogGroup:'), 'LlmProviderEntry must not keep legacy catalogGroup field.');

  const catalogDto = extractExportedTypeDeclaration(settingsTypes, 'LlmProviderCatalogEntry');
  assert(catalogDto.includes('LlmProviderEntry') || catalogDto.includes('protocol'), 'LlmProviderCatalogEntry must derive from provider metadata.');
  assertCatalogTypeOmitsSecrets(catalogDto);
  for (const field of CATALOG_RUNTIME_FIELDS) {
    assert(!new RegExp(`\b${field}\b`, 'u').test(catalogDto), `LlmProviderCatalogEntry must not expose runtime field ${field}.`);
  }

  const catalogResponse = extractInterfaceBody(settingsTypes, 'LlmProviderCatalogResponse');
  assert(catalogResponse.includes('categories:'), 'LlmProviderCatalogResponse must include category descriptors.');
  assert(catalogResponse.includes('protocols:'), 'LlmProviderCatalogResponse must include protocol descriptors.');
  assert(catalogResponse.includes('providers:'), 'LlmProviderCatalogResponse must include provider catalog entries.');

  const ids = BUILTIN_LLM_PROVIDER_DEFINITIONS.map((definition) => definition.id);
  const runtimeEntries = createBuiltinProviderEntries();
  const catalog = loadProviderCatalog(runtimeEntries);
  const catalogEntries = Array.isArray(catalog) ? catalog : catalog.providers;
  assert(Array.isArray(catalogEntries), 'Provider catalog must return provider entries.');
  assert(new Set(ids).size === ids.length, 'Builtin provider ids must be unique.');
  assert(ids.length >= 40, `Builtin provider catalog should expose at least 40 providers, found ${ids.length}.`);
  assert(runtimeEntries.length === ids.length, 'Runtime provider entries should mirror the builtin catalog.');
  assert(catalogEntries.length === ids.length, 'Provider catalog DTO entries should mirror the builtin catalog.');
  for (const id of ['openai', 'anthropic', 'bedrock', 'vertex', 'ollama', 'chatgpt-account', 'claude-account', 'grok-account', 'xai']) {
    assert(ids.includes(id), `Builtin provider is missing: ${id}`);
  }

  const definitionById = new Map(BUILTIN_LLM_PROVIDER_DEFINITIONS.map((definition) => [definition.id, definition]));
  const grokAccount = definitionById.get('grok-account');
  assert(grokAccount?.authMode === 'account', 'grok-account must be an account provider.');
  assert(grokAccount?.category === 'login-authorization', 'grok-account must stay in login authorization.');
  assert(grokAccount?.protocol === 'OpenAICompatibleChatCompletions', 'grok-account must use the OpenAI-compatible chat adapter.');
  assert(grokAccount?.accountLoginConfigured === true, 'grok-account must expose a configured account login path.');
  assert(grokAccount?.label === 'Super Grok Account', 'grok-account must be labeled Super Grok Account in OAuth UI.');
  assert(grokAccount?.unavailableReason === undefined, 'grok-account must not be marked unavailable.');
  for (const modelId of ['grok-4.5', 'grok-4.3', 'grok-code-fast-1']) {
    assert(grokAccount?.recommendedModels.includes(modelId), `grok-account recommended models must include ${modelId}.`);
  }
  const xai = definitionById.get('xai');
  assert(xai?.recommendedModels.includes('grok-code-fast-1'), 'xAI API-key provider must include grok-code-fast-1.');

  if (!Array.isArray(catalog)) {
    assert(Array.isArray(catalog.categories), 'Provider catalog response must include categories.');
    assert(catalog.categories.length === categories.length, 'Provider catalog response must expose all category descriptors.');
    assert(Array.isArray(catalog.protocols), 'Provider catalog response must include protocol descriptors.');
    for (const descriptor of catalog.categories) {
      assertIncludes(categories, descriptor.id, `providerCatalog.category.${descriptor.id}`);
    }
    for (const descriptor of catalog.protocols) {
      assertIncludes(protocols, descriptor.id, `providerCatalog.protocol.${descriptor.id}`);
    }
  }

  const planEntryIds = ids.filter((id) => PLAN_PROVIDER_ID_PATTERN.test(id));
  assert(planEntryIds.length > 0, 'Provider catalog must keep coding/token plan providers as explicit entries.');

  for (const definition of BUILTIN_LLM_PROVIDER_DEFINITIONS) {
    assert(typeof definition.category === 'string', `${definition.id} must declare category.`);
    assertIncludes(categories, definition.category, `${definition.id}.category`);
    assert(!LEGACY_UI_CATEGORIES.includes(definition.category), `${definition.id}.category must not use legacy or unsplit category ${definition.category}.`);
    assert(definition.catalogGroup === undefined, `${definition.id} must not keep legacy catalogGroup.`);
    assert(typeof definition.protocol === 'string', `${definition.id} must declare protocol.`);
    assertIncludes(protocols, definition.protocol, `${definition.id}.protocol`);
    assert(definition.kind === undefined, `${definition.id} must not keep legacy kind.`);
    assertIncludes(VALID_AUTH_MODES, definition.authMode, `${definition.id}.authMode`);
    assert(Array.isArray(definition.capabilities), `${definition.id}.capabilities must be an array.`);
    assert(definition.capabilities.includes('chat'), `${definition.id}.capabilities must include chat.`);
    for (const capability of definition.capabilities) {
      assertIncludes(VALID_CAPABILITIES, capability, `${definition.id}.capability`);
    }

    if (definition.authMode === 'account') {
      assert(definition.category === 'login-authorization', `${definition.id} account provider must use login-authorization category.`);
    }
    if (definition.authMode === 'environment') {
      assert(definition.category === 'cloud-platform', `${definition.id} environment provider must use cloud-platform category.`);
    }
    if (definition.authMode === 'local') {
      assert(definition.category === 'local', `${definition.id} local provider must use local category.`);
    }
    if (PLAN_PROVIDER_ID_PATTERN.test(definition.id)) {
      assert(definition.category === 'coding-token-plan', `${definition.id} plan provider must use coding-token-plan category.`);
    }
    if (definition.modelDiscovery === 'static') {
      assert(!definition.capabilities.includes('model-discovery'), `${definition.id} static discovery must not claim model-discovery.`);
    }
    if (definition.protocolEditable) {
      assert(Array.isArray(definition.protocolOptions) && definition.protocolOptions.length > 1, `${definition.id} protocolEditable providers must declare protocolOptions.`);
      for (const protocol of definition.protocolOptions) {
        assertIncludes(protocols, protocol, `${definition.id}.protocolOptions`);
      }
      if (definition.protocolBaseUrls) {
        for (const protocol of definition.protocolOptions) {
          assert(
            typeof definition.protocolBaseUrls[protocol] === 'string' && definition.protocolBaseUrls[protocol].trim(),
            `${definition.id} protocolBaseUrls must cover ${protocol}.`,
          );
        }
      }
    }
  }

  for (const [index, entry] of catalogEntries.entries()) {
    assert(typeof entry.id === 'string' && entry.id, `providerCatalog.providers[${index}].id must be a stable id.`);
    assertIncludes(categories, entry.category, `${entry.id}.catalog.category`);
    assertIncludes(protocols, entry.protocol, `${entry.id}.catalog.protocol`);
    assertNoForbiddenKeys(entry, [...CATALOG_SECRET_FIELDS, ...CATALOG_RUNTIME_FIELDS], `providerCatalog.providers[${index}]`);
  }

  const providerGroupHelperPath = path.join(process.cwd(), 'src/main/settings/providerCatalogGroup.ts');
  if (fs.existsSync(providerGroupHelperPath)) {
    const helperSource = fs.readFileSync(providerGroupHelperPath, 'utf8');
    assertSourceDoesNotContain(
      helperSource,
      ['catalogGroup', 'kind', 'normalizeProviderCatalogGroup', 'openai-compatible', 'anthropic-compatible'],
      'provider category/protocol helper',
    );
  }

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

  const settingsServiceSource = read('src/main/settings/SettingsService.ts');
  assert(settingsServiceSource.includes('getProviderCatalog'), 'SettingsService must expose getProviderCatalog().');
  const getProviderCatalogIndex = settingsServiceSource.indexOf('getProviderCatalog');
  const getProviderCatalogBody = settingsServiceSource.slice(getProviderCatalogIndex, getProviderCatalogIndex + 2500);
  assertSourceDoesNotContain(getProviderCatalogBody, CATALOG_SECRET_FIELDS, 'SettingsService.getProviderCatalog');
  assert(!settingsServiceSource.includes('DEFAULT_PROVIDER_SEEDS'), 'SettingsService must not auto-seed default providers.');
  assert(!settingsServiceSource.includes('DEFAULT_AGENT_ROUTE_SEEDS'), 'SettingsService must not auto-seed default agent routes.');
  assert(!/sk-or-v1-[A-Za-z0-9]+/.test(settingsServiceSource), 'SettingsService must not contain OpenRouter API keys.');
  assert(!/xai-[A-Za-z0-9]+/.test(settingsServiceSource), 'SettingsService must not contain xAI API keys.');
  assert(!/AIzaSy[A-Za-z0-9_-]+/.test(settingsServiceSource), 'SettingsService must not contain Google API keys.');

  const providerAccountAuthService = read('src/main/settings/ProviderAccountAuthService.ts');
  assertSourceContains(
    providerAccountAuthService,
    [
      'GROK_OPENID_CONFIGURATION_URL',
      'authorization_endpoint',
      'device_authorization_endpoint',
      'token_endpoint',
      'userinfo_endpoint',
      'revocation_endpoint',
      'code_challenge_methods_supported',
      'token_endpoint_auth_methods_supported',
      'fetchGrokOAuthMetadata',
      'resolveGrokOAuthClientId',
      'startGrokBrowserLogin',
      'startGrokDeviceLogin',
      'startGrokCallbackServer',
      'exchangeGrokCode',
      'pollGrokDevice',
      'SUPER_GROK_OAUTH_REDIRECT_URI',
      'getManagedProviderModels',
    ],
    'ProviderAccountAuthService Super Grok OAuth flow',
  );
  assert(!providerAccountAuthService.includes('GROK_API_BASE_URL'), 'Super Grok account models must come from the app-managed catalog, not /models discovery.');
  assert(!providerAccountAuthService.includes('GROK_AUTH_DEVICE_ENDPOINT'), 'Super Grok OAuth device endpoint must come from xAI OIDC metadata.');
  assert(!providerAccountAuthService.includes('GROK_AUTH_TOKEN_ENDPOINT'), 'Super Grok OAuth token endpoint must come from xAI OIDC metadata.');
  assert(!providerAccountAuthService.includes("'Grok OAuth") && !providerAccountAuthService.includes("'Grok OAuth requires"), 'ProviderAccountAuthService must use Super Grok OAuth visible wording.');
  assert(!read('src/renderer/i18n.ts').includes('Grok account login'), 'Settings OAuth copy must not describe Super Grok OAuth as generic Grok account login.');
  assert(!providerAccountAuthService.includes("providerId === 'grok-account' || providerId === 'gemini-account'"), 'grok-account must not remain in the test-only account branch.');
  assert(!providerAccountAuthService.includes('mockable'), 'ProviderAccountAuthService must not keep mockable account terminology.');

  const settingsIpc = read('src/main/ipc/settingsLlmHandlers.ts');
  assertSourceContains(settingsIpc, ['settings:getProviderCatalog', 'settingsService.getProviderCatalog', 'LlmProviderAccountLoginStartRequest'], 'settings IPC handlers');

  const ipcChannels = read('src/main/ipc/channels.ts');
  assert(ipcChannels.includes("'settings:getProviderCatalog'"), 'IPC channel domain must list settings:getProviderCatalog.');

  const preloadSettings = read('src/preload/api/settings.ts');
  assertSourceContains(preloadSettings, ['getProviderCatalog', "ipcRenderer.invoke('settings:getProviderCatalog')"], 'preload SettingsApi');

  const electronApiTypes = read('src/shared/types/electron.ts');
  assert(electronApiTypes.includes('getProviderCatalog'), 'ElectronAPI.settings must type getProviderCatalog().');
  assert(electronApiTypes.includes('LlmProviderAccountLoginStartRequest'), 'ElectronAPI.llm must type provider account login start requests.');

  const browserBridge = read('src/renderer/platform/browserAppBridge/BrowserAppBridge.ts');
  assertSourceContains(browserBridge, ['getProviderCatalog', "this.invoke('settings:getProviderCatalog')"], 'browser app bridge settings API');

  const browserBridgeServer = read('src/main/browserAppBridge/BrowserAppBridgeServer.ts');
  assertSourceContains(browserBridgeServer, ['/api/settings/providers/catalog', 'settings:getProviderCatalog'], 'browser app HTTP provider catalog endpoint');

  for (const relativePath of [
    'src/renderer/features/settings/SettingsModal/sections/ProvidersSettings.tsx',
    'src/renderer/features/settings/SettingsModal/utils.ts',
  ]) {
    const source = read(relativePath);
    assertSourceDoesNotContain(
      source,
      ['catalogGroup', 'LlmProviderCatalogGroup', 'getProviderGroupLabel', 'OpenAI Compatible', 'Anthropic Compatible'],
      relativePath,
    );
  }

  const sharedExports = read('scripts/fidelity/shared-exports.txt');
  for (const expectedExport of [
    'LlmProviderCategory',
    'LlmProviderCatalogEntry',
    'LlmProviderProtocol',
  ]) {
    assert(sharedExports.includes(expectedExport), `shared-exports.txt must include ${expectedExport}.`);
  }
  assert(!sharedExports.includes('LlmProviderCatalogGroup'), 'shared-exports.txt must not keep LlmProviderCatalogGroup.');
  assert(!sharedExports.includes('LlmProviderKind'), 'shared-exports.txt must not keep LlmProviderKind.');

  const connectionService = read('src/main/settings/ProviderConnectionService.ts');
  assert(
    /provider\.id === 'kimi-coding-plan'[\s\S]*provider\.id === 'volcengine-coding-plan'/.test(connectionService)
      && !/volcengine-coding-plan'\)\s*&&\s*provider\.protocol === 'AnthropicMessages'/.test(connectionService),
    'volcengine-coding-plan discovery must share the Coding Plan models-list path for both protocols',
  );
  assert(
    connectionService.includes('resolveVolcengineCodingPlanModelsUrl')
      && connectionService.includes('/v3/models'),
    'volcengine-coding-plan must discover models via /api/coding/v3/models, not Kimi-style /v1/models',
  );
  assert(
    connectionService.includes('aliasesByModelId')
      && connectionService.includes('normalizeCodingPlanModelMatchKey')
      && connectionService.includes('fallbackAvailableOnEmptyMatch'),
    'managed catalog merge must honor aliases, normalize Volcengine list ids, and fall back when list/catalog mismatch',
  );

  const modelRow = read('src/renderer/features/settings/SettingsModal/sections/ProviderConnectModelRow.tsx');
  assert(
    !modelRow.includes('settings-model-row-meta'),
    'unavailable model rows must not inline long availability meta next to the model id',
  );

  const connectionActions = read('src/renderer/features/settings/SettingsModal/useProviderConnectionActions.ts');
  assert(
    !/updateConnectionDraft\(\{\s*busy:\s*'testing',\s*error:\s*'',\s*models:\s*\[\]\s*\}\)/.test(connectionActions),
    'provider Test must not clear models to [] at start (dialog shrink)',
  );

  console.log('[provider-system] OK');
}

main().catch((error) => {
  console.error('[provider-system] FAILED');
  console.error(error);
  process.exitCode = 1;
});

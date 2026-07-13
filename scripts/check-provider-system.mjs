import { createRequire } from 'module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
require('./register-ts-source.cjs');

const {
  createProviderEntriesFromPresets,
  listProviderPresets,
} = require('../src/main/settings/ProviderPresetRegistry.ts');
const providerPresets = listProviderPresets();
const providerDefinitions = createProviderEntriesFromPresets();
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

function listSourceFiles(relativeDirectory) {
  const root = path.join(process.cwd(), relativeDirectory);
  return fs.readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:ts|tsx)$/u.test(entry.name))
    .map((entry) => path.join(entry.parentPath ?? entry.path, entry.name));
}

function assertJsonSerializable(value, label, seen = new Set()) {
  assert(value !== undefined, `${label} must not contain undefined.`);
  assert(!['function', 'symbol', 'bigint'].includes(typeof value), `${label} must be JSON-serializable.`);
  if (!value || typeof value !== 'object') return;
  assert(!seen.has(value), `${label} must not contain cycles.`);
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertJsonSerializable(entry, `${label}[${index}]`, seen));
  } else {
    Object.entries(value).forEach(([key, entry]) => assertJsonSerializable(entry, `${label}.${key}`, seen));
  }
  seen.delete(value);
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
  const servicePath = path.join(process.cwd(), 'src/main/settings/ProviderCatalogService.ts');
  assert(fs.existsSync(servicePath), 'ProviderCatalogService.ts or the preset registry must provide catalog DTOs.');
  const { providerCatalogService } = require('../src/main/settings/ProviderCatalogService.ts');
  assert(providerCatalogService?.getProviderCatalog, 'ProviderCatalogService must expose getProviderCatalog().');
  return providerCatalogService.getProviderCatalog(runtimeEntries);
}

async function main() {
  assert(providerPresets.length === 61, `Provider registry must load 46 migrated, 12 data-only, and 3 live-verification presets, found ${providerPresets.length}.`);
  const presetIds = providerPresets.map((preset) => preset.id);
  assert(new Set(presetIds).size === presetIds.length, 'Provider preset ids must be unique.');
  const presetFiles = fs.readdirSync(path.join(process.cwd(), 'src/main/settings/presets'))
    .filter((name) => name.endsWith('.ts') && name !== 'index.ts')
    .map((name) => name.slice(0, -3))
    .sort();
  assert(
    JSON.stringify(presetFiles) === JSON.stringify([...presetIds].sort()),
    'Provider presets must use exactly one provider-id-named file per registered provider.',
  );
  for (const preset of providerPresets) {
    assert(preset.schemaVersion === 1, `${preset.id} must use ProviderPreset schemaVersion 1.`);
    assertJsonSerializable(preset, `preset.${preset.id}`);
    assert(JSON.parse(JSON.stringify(preset)).id === preset.id, `${preset.id} must survive a JSON round trip.`);
  }

  const legacyBuiltinDefinitionToken = `BUILTIN_LLM_PROVIDER_${'DEFINITIONS'}`;
  const removedResolvedCapabilityToken = `ResolvedModel${'Capability'}`;
  const removedResolverToken = `ModelCapability${'Resolver'}`;
  const removedFastVariantToken = `fastVariant${'ModelId'}`;
  const removedDefaultWindowToken = `DEFAULT_CONTEXT_${'WINDOW_TOKENS'}`;
  const removedDiscoveryProjectionToken = `model${'Discovery'}`;
  for (const sourcePath of listSourceFiles('src')) {
    assertSourceDoesNotContain(
      fs.readFileSync(sourcePath, 'utf8'),
      [
        legacyBuiltinDefinitionToken,
        removedResolvedCapabilityToken,
        removedResolverToken,
        removedFastVariantToken,
        removedDefaultWindowToken,
        removedDiscoveryProjectionToken,
      ],
      path.relative(process.cwd(), sourcePath),
    );
  }
  const sharedLlmSource = read('src/shared/constants/llm.ts');
  assertSourceDoesNotContain(
    sharedLlmSource,
    [legacyBuiltinDefinitionToken, 'recommendedModels:', "id: 'openai'", "id: 'anthropic'"],
    'shared llm constants',
  );
  assert(!fs.existsSync(path.join(process.cwd(), 'src/shared/constants/modelCapabilityCatalog.ts')), 'The legacy static model capability catalog must be deleted.');
  const forbiddenRuntimeCatalogImports = ['ProviderPresetRegistry', '/presets', 'modelCapabilityCatalog'];
  for (const sourcePath of listSourceFiles('src/main/agent-runtime')) {
    assertSourceDoesNotContain(fs.readFileSync(sourcePath, 'utf8'), forbiddenRuntimeCatalogImports, path.relative(process.cwd(), sourcePath));
  }
  for (const sourcePath of listSourceFiles('src/renderer')) {
    assertSourceDoesNotContain(fs.readFileSync(sourcePath, 'utf8'), ['ProviderPresetRegistry', '/presets', 'modelCapabilityCatalog'], path.relative(process.cwd(), sourcePath));
  }
  assertSourceContains(read('src/main/settings/SettingsService.ts'), ['createProviderEntriesFromPresets', 'getProviderSeedModels'], 'SettingsService preset loading');
  assertSourceContains(read('src/main/settings/EffectiveModelResolver.ts'), ['getProviderSeedModelDefinitions', 'lookupProviderSeedModel'], 'EffectiveModelResolver preset loading');

  const settingsTypes = read('src/shared/types/settings.ts');
  const connectionServiceSource = read('src/main/settings/ProviderConnectionService.ts');
  const providerConnectDialog = read('src/renderer/features/settings/SettingsModal/sections/ProviderConnectDialog.tsx');
  assert(
    settingsTypes.includes('discoveryDiagnostic?:')
      && connectionServiceSource.includes('discoveredModelCount: discoveredModels.length')
      && connectionServiceSource.includes("providerId === 'volcengine-coding-plan'")
      && connectionServiceSource.includes('selectSupportedCodingPlanModels')
      && providerConnectDialog.includes('settings-provider-connect-discovery-diagnostic'),
    'provider connection must expose redacted discovery counts and keep empty-match fallback scoped to Volcengine Coding Plan',
  );
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

  const ids = providerDefinitions.map((definition) => definition.id);
  const runtimeEntries = createProviderEntriesFromPresets();
  const catalog = loadProviderCatalog(runtimeEntries);
  const catalogEntries = Array.isArray(catalog) ? catalog : catalog.providers;
  assert(Array.isArray(catalogEntries), 'Provider catalog must return provider entries.');
  assert(new Set(ids).size === ids.length, 'Builtin provider ids must be unique.');
  assert(ids.length >= 40, `Builtin provider catalog should expose at least 40 providers, found ${ids.length}.`);
  assert(runtimeEntries.length === ids.length, 'Runtime provider entries should mirror the builtin catalog.');
  assert(catalogEntries.length === ids.length, 'Provider catalog DTO entries should mirror the builtin catalog.');
  for (const id of ['openai', 'anthropic', 'bedrock', 'vertex', 'ollama', 'chatgpt-account', 'claude-account', 'grok-account', 'minimax-account', 'opencode-go', 'cline', 'xai']) {
    assert(ids.includes(id), `Builtin provider is missing: ${id}`);
  }

  const definitionById = new Map(providerDefinitions.map((definition) => [definition.id, definition]));
  const presetById = new Map(providerPresets.map((preset) => [preset.id, preset]));
  const grokAccount = definitionById.get('grok-account');
  assert(grokAccount?.authMode === 'account', 'grok-account must be an account provider.');
  assert(grokAccount?.category === 'login-authorization', 'grok-account must stay in login authorization.');
  assert(grokAccount?.protocol === 'OpenAIResponses', 'grok-account must default to the Grok Build Responses surface.');
  assert(grokAccount?.accountLoginConfigured === true, 'grok-account must expose a configured account login path.');
  assert(grokAccount?.label === 'Super Grok Account', 'grok-account must be labeled Super Grok Account in OAuth UI.');
  assert(grokAccount?.unavailableReason === undefined, 'grok-account must not be marked unavailable.');
  assert(grokAccount?.recommendedModels.length === 0, 'grok-account must not retain a static recommended model table.');
  assert(grokAccount?.catalogOwnership === 'app-managed', 'grok-account must be owned by its dynamic account catalog.');
  const cline = definitionById.get('cline');
  assert(cline?.authMode === 'api-key' && cline?.authModeOptions?.includes('account'), 'Cline must expose API key and account auth modes.');
  const openRouter = definitionById.get('openrouter');
  assert(openRouter?.authModeOptions?.includes('account'), 'OpenRouter must expose its PKCE account option alongside API key auth.');
  assert(openRouter?.accountLoginConfigured === true, 'OpenRouter PKCE must be reachable through the account login service.');
  assert(openRouter?.authModeAvailability?.['api-key']?.state !== 'unavailable', 'OpenRouter API key mode must remain independently available.');
  assert(openRouter?.authModeAvailability?.account?.state !== 'unavailable', 'OpenRouter PKCE account mode must remain independently available.');
  assert(cline?.authModeAvailability?.account?.state === 'unavailable', 'Cline OAuth must remain unavailable until its public contract is verified.');
  const minimaxAccount = definitionById.get('minimax-account');
  assert(minimaxAccount?.status === 'unavailable', 'MiniMax OAuth must remain unavailable before live verification.');
  assert(minimaxAccount?.accountLoginConfigured === false, 'MiniMax OAuth flow must not be reachable before live verification.');
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

  for (const definition of providerDefinitions) {
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
    if (definition.capabilities.includes('model-discovery')) {
      assert(presetById.get(definition.id)?.discovery, `${definition.id} must declare its discovery contract in the preset.`);
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
      'GROK_OAUTH_CLIENT_ID',
      'startGrokBrowserLogin',
      'startGrokDeviceLogin',
      'startGrokCallbackServer',
      'exchangeGrokCode',
      'pollGrokDevice',
      'SUPER_GROK_OAUTH_REDIRECT_URI',
      'parseGrokBuilderCatalog',
      'parseGrokAccountCatalog',
      'GROK_BUILD_API_BASE_URL',
      'XAI_API_BASE_URL',
    ],
    'ProviderAccountAuthService Super Grok OAuth flow',
  );
  assert(!providerAccountAuthService.includes('oauthClientId'), 'Super Grok login must not require a user-supplied OAuth client id.');
  assertSourceContains(
    providerAccountAuthService,
    ['openrouter', 'startOpenRouterLogin', 'buildOpenRouterAuthorizationUrl', 'buildOpenRouterExchange', 'minimax-account', 'startMiniMaxLogin'],
    'OpenRouter and MiniMax account flows',
  );
  assert(!providerAccountAuthService.includes('.grok/auth.json'), 'RDC-Agent must not import Grok Builder private credentials.');
  assert(!providerAccountAuthService.includes('AppData\\Local\\Grok'), 'RDC-Agent must not couple to Grok Builder user-data paths.');
  const liveOAuthContracts = read('src/main/settings/LiveProviderOAuthContracts.ts');
  assertSourceContains(liveOAuthContracts, ['MINIMAX_REFERENCE', '/oauth/code', '/oauth/token', 'OPENROUTER_AUTHORIZE_URL', 'OPENROUTER_EXCHANGE_URL'], 'live provider OAuth contracts');
  const liveCatalogParsers = read('src/main/settings/LiveProviderCatalogParsers.ts');
  assertSourceContains(liveCatalogParsers, [
    'parseOpenCodeGoCatalog',
    'parseClineCatalog',
    'parseChatGptAccountCatalog',
    'parseClaudeAccountCatalog',
    'parseGrokBuilderCatalog',
    'parseGrokAccountCatalog',
  ], 'live provider catalog parsers');
  assertSourceContains(
    read('src/main/settings/DeclarativeCatalogDiscovery.ts'),
    ['routeRules', 'contextWindowKind', 'toolCalling', 'visionInput', 'structuredOutput'],
    'declarative discovery capability projection',
  );
  for (const providerId of [
    'longcat', 'opencode-zen', 'together-ai', 'fireworks-ai', 'novita-ai', 'synthetic',
    'chutes', 'nvidia-nim', 'github-models', 'ollama-cloud',
  ]) {
    const preset = presetById.get(providerId);
    assert(preset?.discovery?.kind === 'json-catalog', `${providerId} must use declarative JSON discovery.`);
    assert(preset.discovery.modelSet === 'authoritative', `${providerId} discovery must admit its current live catalog instead of validating a static seed allowlist.`);
  }
  const longcat = presetById.get('longcat');
  assert(longcat?.routes[0]?.protocol === 'OpenAICompatibleChatCompletions', 'LongCat must use its documented Chat Completions route, not Responses.');
  assert(longcat?.discovery?.kind === 'json-catalog' && longcat.discovery.url === 'https://api.longcat.chat/v1/models', 'LongCat must use the documented unified model catalog endpoint.');
  const zen = presetById.get('opencode-zen');
  assert(zen?.discovery?.kind === 'json-catalog' && zen.discovery.routeRules?.length === 3, 'OpenCode Zen must project model-level Responses, Messages, and Chat routes.');
  const fireworks = presetById.get('fireworks-ai');
  assert(
    fireworks?.discovery?.kind === 'json-catalog'
      && fireworks.discovery.url?.includes('/v1/accounts/fireworks/models?filter=supports_serverless'),
    'Fireworks discovery must use the documented serverless management catalog, not inference /models.',
  );
  const githubModels = presetById.get('github-models');
  assert(githubModels?.routes[0]?.headers?.['X-GitHub-Api-Version'] === '2026-03-10', 'GitHub Models must use the current versioned API header.');
  assert(githubModels?.discovery?.kind === 'json-catalog' && githubModels.discovery.mapping.contextWindow === 'limits.max_input_tokens', 'GitHub Models must project current catalog limit fields.');
  assert(presetById.get('together-ai')?.discovery?.kind === 'json-catalog' && presetById.get('together-ai').discovery.collectionPath === '$', 'Together model discovery must parse its documented bare array response.');
  const capabilityContractTest = read('src/main/settings/ProviderCapabilityContract.test.ts');
  assertSourceContains(capabilityContractTest, ['effective-model-contract.json', 'fixtures/provider-catalogs'], 'final provider capability fixture contract');
  const requestPlanner = read('src/main/settings/RequestPlanner.ts');
  const contextTierPolicy = read('src/shared/utils/contextTiers.ts');
  const modelControlPolicy = read('src/shared/utils/modelControls.ts');
  const rendererTurnControls = read('src/renderer/features/debugger/composer/turnControlsUtils.ts');
  assert(!requestPlanner.includes('256_000') && !requestPlanner.includes('256000'), 'RequestPlanner must never invent a fixed 256K budget.');
  assert(!contextTierPolicy.includes('1_000_000') && !contextTierPolicy.includes('1000000'), 'Max selection must not use a 1M token threshold.');
  assertSourceContains(requestPlanner, ['resolveContextTierChoices', 'evaluateModelControls'], 'RequestPlanner shared capability policy');
  assertSourceContains(rendererTurnControls, ['resolveContextTierChoices', 'evaluateModelControls'], 'renderer shared capability policy');
  assertSourceContains(modelControlPolicy, ['CONSTRAINT_CYCLE', 'isFastModeSelectable'], 'shared model-control evaluator');
  const effectiveModelResolver = read('src/main/settings/EffectiveModelResolver.ts');
  assertSourceContains(
    effectiveModelResolver,
    ['completeDiscoveryContributions', 'resolveEffectiveModelSelection', 'selectEffectiveModelFromSnapshot', 'Same-provider recommendations'],
    'model disappearance and remap policy',
  );
  const discoveryAdmission = read('src/main/settings/DiscoveryAdmission.ts');
  assertSourceContains(
    discoveryAdmission,
    ['NON_AGENT_MODALITIES', 'extractDiscoveredModelIdentity', 'unproven-alias'],
    'discovery admission policy',
  );
  const protocolSwitch = read('src/main/settings/ProviderProtocolSwitchService.ts');
  assertSourceContains(
    protocolSwitch,
    ['resolveProtocolRouteModels', 'invalidateDiscovery', 'clampControlsForProtocolModels', 'MODEL_UNAVAILABLE after protocol reprojection'],
    'protocol reprojection service',
  );
  assertSourceContains(
    read('src/main/settings/ProviderProtocolSwitchIntegration.test.ts'),
    ['invalidates the old protocol cache', 'preserves fixed model routes', 'clamps persisted turn controls'],
    'protocol reprojection integration test',
  );
  assertSourceContains(read('src/main/settings/ProviderQuota.ts'), ['recordTransientQuota', 'response.status !== 429'], 'transient quota policy');
  assert(!read('src/main/agent-runtime/core/types.ts').includes('ProviderCapabilities'), 'Runtime must not retain a second boolean capability matrix.');
  const runtimeCoreTypes = read('src/main/agent-runtime/core/types.ts');
  assert(
    /requestPlan:\s*RequestPlan;/u.test(runtimeCoreTypes)
      && !/requestPlan\?:\s*RequestPlan/u.test(runtimeCoreTypes),
    'Every provider stream must require a closed RequestPlan.',
  );
  assertSourceContains(
    read('src/main/agent-runtime/agent/AgentLoop.ts'),
    ['provider.stream(config.model, llmContext, streamOptions)'],
    'AgentLoop RequestPlan forwarding',
  );
  for (const adapter of [
    'AnthropicProvider.ts',
    'GeminiProvider.ts',
    'OllamaProvider.ts',
    'OpenAICompatibleProvider.ts',
    'OpenAIResponsesProvider.ts',
  ]) {
    const source = read(`src/main/agent-runtime/providers/${adapter}`);
    assertSourceContains(
      source,
      ['options.requestPlan', 'applyRequestPlanBody', 'requestPlanHeaders'],
      `${adapter} RequestPlan wire path`,
    );
  }
  const contextManager = read('src/main/agent-runtime/agent/ContextManager.ts');
  assertSourceDoesNotContain(contextManager, ['256_000', '256000', 'model.contextWindow'], 'ContextManager');
  assertSourceContains(contextManager, ['RequestPlan context budget'], 'ContextManager fail-closed budget policy');
  assertSourceDoesNotContain(
    read('src/shared/types/modelCapability.ts'),
    ["value === 'auto'", "value === 'extHigh'"],
    'canonical reasoning selection contract',
  );
  const configuredRuntimeProvider = read('src/main/agent-runtime/providers/ConfiguredRuntimeProvider.ts');
  assertSourceContains(
    configuredRuntimeProvider,
    ['COPILOT_WIRE_HEADERS', 'CLAUDE_ACCOUNT_WIRE_HEADERS', "provider.id === 'github-copilot'", "provider.id === 'claude-account'"],
    'account provider runtime wire headers',
  );
  assertSourceContains(
    read('src/main/agent-runtime/providers/AnthropicProvider.ts'),
    ['mergeAnthropicRequestHeaders', "name.toLowerCase() !== 'anthropic-beta'"],
    'Anthropic beta header composition',
  );
  const providerAccountPanel = read('src/renderer/features/settings/SettingsModal/sections/ProviderAccountOAuthPanel.tsx');
  assertSourceDoesNotContain(providerAccountPanel, ['oauthClientId', 'requiresClientId', 'clientIdSource'], 'Super Grok account panel');
  for (const sourcePath of listSourceFiles('src/main/agent-runtime/providers')) {
    assertSourceDoesNotContain(fs.readFileSync(sourcePath, 'utf8'), ['getCapabilities()'], path.relative(process.cwd(), sourcePath));
  }
  const effectiveCatalogTest = read('src/main/settings/EffectiveCatalogService.test.ts');
  assertSourceContains(effectiveCatalogTest, ['2 ** layers.length', 'mask=${mask}', 'last present leaf provenance'], 'six-layer deterministic combination tests');
  assert(!providerAccountAuthService.includes('GROK_AUTH_DEVICE_ENDPOINT'), 'Super Grok OAuth device endpoint must come from xAI OIDC metadata.');
  assert(!providerAccountAuthService.includes('GROK_AUTH_TOKEN_ENDPOINT'), 'Super Grok OAuth token endpoint must come from xAI OIDC metadata.');
  assert(!providerAccountAuthService.includes("'Grok OAuth") && !providerAccountAuthService.includes("'Grok OAuth requires"), 'ProviderAccountAuthService must use Super Grok OAuth visible wording.');
  assert(!read('src/renderer/i18n.ts').includes('Grok account login'), 'Settings OAuth copy must not describe Super Grok OAuth as generic Grok account login.');
  assert(!providerAccountAuthService.includes("providerId === 'grok-account' || providerId === 'gemini-account'"), 'grok-account must not remain in the test-only account branch.');
  assert(!providerAccountAuthService.includes('mockable'), 'ProviderAccountAuthService must not keep mockable account terminology.');

  const settingsIpc = read('src/main/ipc/settingsLlmHandlers.ts');
  assertSourceContains(settingsIpc, [
    'settings:getProviderCatalog',
    'settingsService.getProviderCatalog',
    'LlmProviderAccountLoginStartRequest',
    "llm:testModelCapability",
    'providerCapabilityProbeService.test',
  ], 'settings IPC handlers');

  const capabilityProbeRuntime = read('src/main/settings/ProviderCapabilityProbeRuntime.ts');
  assertSourceContains(capabilityProbeRuntime, [
    'requestEnvelopeBuilder.build',
    'configuredRuntimeProvider.stream',
    'requestPlan: input.plan',
    'tools: []',
    'maxTokens: 1',
  ], 'explicit model capability probe canonical runtime path');
  assertSourceDoesNotContain(
    capabilityProbeRuntime,
    ['fetch(', 'axios', 'got('],
    'explicit model capability probe raw network bypass',
  );
  const capabilityProbeService = read('src/main/settings/ProviderCapabilityProbeService.ts');
  assertSourceContains(capabilityProbeService, [
    "request.mode === 'max-context'",
    "activation.kind === 'implicit'",
    "status === 404",
    "status === 400 || status === 403",
    'effectiveCatalogService.recordObserved',
  ], 'explicit model capability evidence policy');

  const ipcChannels = read('src/main/ipc/channels.ts');
  assert(ipcChannels.includes("'settings:getProviderCatalog'"), 'IPC channel domain must list settings:getProviderCatalog.');

  const preloadSettings = read('src/preload/api/settings.ts');
  assertSourceContains(preloadSettings, [
    'getProviderCatalog',
    "ipcRenderer.invoke('settings:getProviderCatalog')",
    'testModelCapability',
    "ipcRenderer.invoke('llm:testModelCapability'",
  ], 'preload SettingsApi');

  const electronApiTypes = read('src/shared/types/electron.ts');
  assert(electronApiTypes.includes('getProviderCatalog'), 'ElectronAPI.settings must type getProviderCatalog().');
  assert(electronApiTypes.includes('LlmProviderAccountLoginStartRequest'), 'ElectronAPI.llm must type provider account login start requests.');

  const browserBridge = read('src/renderer/platform/browserAppBridge/BrowserAppBridge.ts');
  assertSourceContains(browserBridge, [
    'getProviderCatalog',
    "this.invoke('settings:getProviderCatalog')",
    'testModelCapability',
    "this.invoke('llm:testModelCapability'",
  ], 'browser app bridge settings API');

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
      && connectionService.includes('filteredModelCount'),
    'managed catalog merge must honor aliases, normalize Volcengine list ids, and hide unmatched Volc catalog models',
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
  assertSourceContains(settingsTypes, ['authAccountIds?:', 'hasStoredSecretByAuthMode?:', 'authModeAvailability?:'], 'multi-auth provider settings contract');
  assertSourceContains(read('src/main/settings/SettingsService.ts'), ['authAccountIds', 'hasStoredSecretByAuthMode', 'disconnectProvider('], 'multi-auth credential isolation');
  assertSourceContains(
    read('src/main/settings/SettingsService.ts'),
    ['SETTINGS_SCHEMA_VERSION = 2', 'copySecret(', 'deleteSecretsAfterCommit', 'schemaVersion: SETTINGS_SCHEMA_VERSION'],
    'versioned account-keyed credential migration',
  );
  assertSourceDoesNotContain(read('src/main/settings/SecretStorageService.ts'), ['moveSecret('], 'credential transaction API');
  assertSourceContains(read('src/renderer/features/settings/SettingsModal/sections/ProviderConnectDialog.tsx'), ['ProviderAuthModeField'], 'provider auth-mode Settings UI');

  console.log('[provider-system] OK');
}

main().catch((error) => {
  console.error('[provider-system] FAILED');
  console.error(error);
  process.exitCode = 1;
});

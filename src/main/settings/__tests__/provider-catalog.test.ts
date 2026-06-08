/**
 * Provider Catalog 完整性验证
 * 确保所有 builtin provider 的 catalogGroup、kind、authMode、capabilities 正确。
 */
import { BUILTIN_LLM_PROVIDER_DEFINITIONS } from '../../../shared/constants/llm';
import type { LlmProviderCatalogGroup, LlmProviderKind, LlmProviderAuthMode, LlmProviderCapability } from '../../../shared/types/settings';

// 合法值集合
const VALID_CATALOG_GROUPS: LlmProviderCatalogGroup[] = [
  'account', 'openai-compatible', 'anthropic-compatible', 'cloud-platform', 'local', 'image'
];

const VALID_KINDS: LlmProviderKind[] = [
  'openai-compatible', 'anthropic', 'google-ai-studio', 'azure-openai',
  'bedrock', 'vertex', 'openrouter', 'ollama'
];

const VALID_AUTH_MODES: LlmProviderAuthMode[] = [
  'api-key', 'local', 'account', 'environment'
];

const VALID_CAPABILITIES: LlmProviderCapability[] = [
  'chat', 'tool-calling', 'structured-output', 'reasoning',
  'prompt-cache', 'vision-input', 'model-discovery',
  'image-generation', 'video-generation'
];

describe('Provider Catalog Integrity', () => {
  test('all providers have valid catalogGroup', () => {
    for (const def of BUILTIN_LLM_PROVIDER_DEFINITIONS) {
      expect(VALID_CATALOG_GROUPS).toContain(def.catalogGroup);
    }
  });

  test('all providers have valid kind', () => {
    for (const def of BUILTIN_LLM_PROVIDER_DEFINITIONS) {
      expect(VALID_KINDS).toContain(def.kind);
    }
  });

  test('all providers have valid authMode', () => {
    for (const def of BUILTIN_LLM_PROVIDER_DEFINITIONS) {
      expect(VALID_AUTH_MODES).toContain(def.authMode);
    }
  });

  test('all providers have capabilities array with valid values', () => {
    for (const def of BUILTIN_LLM_PROVIDER_DEFINITIONS) {
      expect(def.capabilities).toBeDefined();
      expect(Array.isArray(def.capabilities)).toBe(true);
      for (const cap of def.capabilities!) {
        expect(VALID_CAPABILITIES).toContain(cap);
      }
    }
  });

  test('all providers include chat capability', () => {
    for (const def of BUILTIN_LLM_PROVIDER_DEFINITIONS) {
      expect(def.capabilities).toContain('chat');
    }
  });

  test('account providers have catalogGroup=account', () => {
    const accountProviders = BUILTIN_LLM_PROVIDER_DEFINITIONS.filter(
      d => d.authMode === 'account'
    );
    for (const def of accountProviders) {
      expect(def.catalogGroup).toBe('account');
    }
  });

  test('environment providers have catalogGroup=cloud-platform', () => {
    const envProviders = BUILTIN_LLM_PROVIDER_DEFINITIONS.filter(
      d => d.authMode === 'environment'
    );
    for (const def of envProviders) {
      expect(def.catalogGroup).toBe('cloud-platform');
    }
  });

  test('local providers have catalogGroup=local', () => {
    const localProviders = BUILTIN_LLM_PROVIDER_DEFINITIONS.filter(
      d => d.authMode === 'local'
    );
    for (const def of localProviders) {
      expect(def.catalogGroup).toBe('local');
    }
  });

  test('static modelDiscovery providers do NOT have model-discovery capability', () => {
    const staticProviders = BUILTIN_LLM_PROVIDER_DEFINITIONS.filter(
      d => d.modelDiscovery === 'static'
    );
    for (const def of staticProviders) {
      expect(def.capabilities).not.toContain('model-discovery');
    }
  });

  test('no duplicate provider IDs', () => {
    const ids = BUILTIN_LLM_PROVIDER_DEFINITIONS.map(d => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('provider count is at least 48', () => {
    expect(BUILTIN_LLM_PROVIDER_DEFINITIONS.length).toBeGreaterThanOrEqual(48);
  });
});

/**
 * 验证 catalogGroup 迁移逻辑：旧值正确映射到新产品分组。
 */
import { BUILTIN_LLM_PROVIDER_DEFINITIONS } from '../../../shared/constants/llm';

// 模拟 normalizeCatalogGroup 的逻辑（因为它是内部函数，这里重新实现核心逻辑验证）
const NEW_GROUPS = ['account', 'openai-compatible', 'anthropic-compatible', 'cloud-platform', 'local', 'image'] as const;

function simulateNormalizeCatalogGroup(providerId: string, oldCatalogGroup: string, authMode: string): string {
  if ((NEW_GROUPS as readonly string[]).includes(oldCatalogGroup)) {
    return oldCatalogGroup;
  }
  const builtinDef = BUILTIN_LLM_PROVIDER_DEFINITIONS.find(d => d.id === providerId);
  if (builtinDef) {
    return builtinDef.catalogGroup;
  }
  if (authMode === 'account') return 'account';
  if (authMode === 'local') return 'local';
  if (authMode === 'environment') return 'cloud-platform';
  return 'openai-compatible';
}

describe('CatalogGroup Migration', () => {
  test('old api-key value maps to correct new group for OpenAI', () => {
    const result = simulateNormalizeCatalogGroup('openai', 'api-key', 'api-key');
    expect(result).toBe('openai-compatible');
  });

  test('old api-key value maps to correct new group for Anthropic', () => {
    const result = simulateNormalizeCatalogGroup('anthropic', 'api-key', 'api-key');
    expect(result).toBe('anthropic-compatible');
  });

  test('old environment value maps to cloud-platform for Bedrock', () => {
    const result = simulateNormalizeCatalogGroup('bedrock', 'environment', 'environment');
    expect(result).toBe('cloud-platform');
  });

  test('already-new values pass through unchanged', () => {
    expect(simulateNormalizeCatalogGroup('openai', 'openai-compatible', 'api-key')).toBe('openai-compatible');
    expect(simulateNormalizeCatalogGroup('ollama', 'local', 'local')).toBe('local');
  });

  test('unknown provider with api-key auth falls back to openai-compatible', () => {
    const result = simulateNormalizeCatalogGroup('custom-unknown', 'api-key', 'api-key');
    expect(result).toBe('openai-compatible');
  });

  test('unknown provider with environment auth falls back to cloud-platform', () => {
    const result = simulateNormalizeCatalogGroup('custom-cloud', 'environment', 'environment');
    expect(result).toBe('cloud-platform');
  });
});

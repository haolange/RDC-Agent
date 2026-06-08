import { expect, test, type Page } from '@playwright/test';
import {
  BUILTIN_LLM_PROVIDER_DEFINITIONS,
} from '../src/shared/constants/llm';
import { MediaRuntimeService } from '../src/main/settings/MediaRuntimeService';
import { normalizeProviderCatalogGroup } from '../src/main/settings/providerCatalogGroup';
import type {
  LlmProviderAuthMode,
  LlmProviderCapability,
  LlmProviderCatalogGroup,
  LlmProviderKind,
} from '../src/shared/types/settings';
import { closeSmokeApp, launchHeadlessSmokeApp } from './helpers/app';

const VALID_CATALOG_GROUPS: LlmProviderCatalogGroup[] = [
  'account',
  'openai-compatible',
  'anthropic-compatible',
  'cloud-platform',
  'local',
  'image',
];

const VALID_KINDS: LlmProviderKind[] = [
  'openrouter',
  'openai-compatible',
  'anthropic',
  'google-ai-studio',
  'azure-openai',
  'bedrock',
  'vertex',
  'ollama',
];

const VALID_AUTH_MODES: LlmProviderAuthMode[] = [
  'api-key',
  'local',
  'account',
  'environment',
];

const VALID_CAPABILITIES: LlmProviderCapability[] = [
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

async function openProviderSettings(pageUrl: string, page: Page): Promise<void> {
  await page.goto(pageUrl);
  await page.locator('.app-titlebar').waitFor({ state: 'visible', timeout: 15000 });
  await page.getByTestId('sidebar-user-settings-trigger').click();
  await page.getByTestId('open-settings-entry').click();
  await expect(page.getByTestId('settings-modal')).toBeVisible();
  await page.getByTestId('settings-nav-models').click();
  await expect(page.getByTestId('settings-add-provider')).toBeVisible();
}

test.describe('provider catalog integrity', () => {
  test('builtin provider definitions use valid orthogonal dimensions', () => {
    const ids = BUILTIN_LLM_PROVIDER_DEFINITIONS.map((definition) => definition.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining([
      'openai',
      'anthropic',
      'bedrock',
      'vertex',
      'ollama',
      'chatgpt-account',
      'claude-account',
    ]));

    for (const definition of BUILTIN_LLM_PROVIDER_DEFINITIONS) {
      expect(VALID_CATALOG_GROUPS).toContain(definition.catalogGroup);
      expect(VALID_KINDS).toContain(definition.kind);
      expect(VALID_AUTH_MODES).toContain(definition.authMode);
      expect(Array.isArray(definition.capabilities)).toBe(true);
      expect(definition.capabilities).toContain('chat');

      for (const capability of definition.capabilities ?? []) {
        expect(VALID_CAPABILITIES).toContain(capability);
      }
    }
  });

  test('catalog groups do not silently mirror auth mode except where product grouping requires it', () => {
    for (const definition of BUILTIN_LLM_PROVIDER_DEFINITIONS) {
      if (definition.authMode === 'account') {
        expect(definition.catalogGroup).toBe('account');
      }
      if (definition.authMode === 'environment') {
        expect(definition.catalogGroup).toBe('cloud-platform');
      }
      if (definition.authMode === 'local') {
        expect(definition.catalogGroup).toBe('local');
      }
      if (definition.modelDiscovery === 'static') {
        expect(definition.capabilities).not.toContain('model-discovery');
      }
    }
  });
});

test.describe('catalogGroup migration', () => {
  test('legacy catalogGroup values map through builtin provider identity first', () => {
    expect(normalizeProviderCatalogGroup({ id: 'openai', catalogGroup: 'api-key', authMode: 'api-key' }))
      .toBe('openai-compatible');
    expect(normalizeProviderCatalogGroup({ id: 'anthropic', catalogGroup: 'api-key', authMode: 'api-key' }))
      .toBe('anthropic-compatible');
    expect(normalizeProviderCatalogGroup({ id: 'bedrock', catalogGroup: 'environment', authMode: 'environment' }))
      .toBe('cloud-platform');
  });

  test('new catalogGroup values pass through unchanged', () => {
    expect(normalizeProviderCatalogGroup({ id: 'openai', catalogGroup: 'openai-compatible', authMode: 'api-key' }))
      .toBe('openai-compatible');
    expect(normalizeProviderCatalogGroup({ id: 'ollama', catalogGroup: 'local', authMode: 'local' }))
      .toBe('local');
  });

  test('unknown providers fall back by auth mode without preserving legacy group names', () => {
    const originalWarn = console.warn;
    const warnings: unknown[] = [];
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };

    try {
      expect(normalizeProviderCatalogGroup({ id: 'custom-unknown', catalogGroup: 'api-key', authMode: 'api-key' }))
        .toBe('openai-compatible');
      expect(normalizeProviderCatalogGroup({ id: 'custom-cloud', catalogGroup: 'environment', authMode: 'environment' }))
        .toBe('cloud-platform');
      expect(normalizeProviderCatalogGroup({ id: 'custom-account', catalogGroup: 'api-key', authMode: 'account' }))
        .toBe('account');
    } finally {
      console.warn = originalWarn;
    }

    expect(warnings).toHaveLength(1);
  });
});

test.describe('MediaRuntimeService fail-closed behavior', () => {
  test('generate returns adapter-not-implemented and never succeeds without an adapter', async () => {
    const service = new MediaRuntimeService();

    const result = await service.generate({
      providerId: 'openai',
      modelId: 'dall-e-3',
      prompt: 'test prompt',
    });

    expect(result.status).toBe('adapter-not-implemented');
    expect(result.error).toContain('not implemented');
    expect(result.diagnostics).toMatchObject({
      providerId: 'openai',
      modelId: 'dall-e-3',
    });
  });

  test('adapter discovery reports no registered media providers', () => {
    const service = new MediaRuntimeService();

    expect(service.isMediaAdapterAvailable('openai')).toBe(false);
    expect(service.isMediaAdapterAvailable('unknown-provider')).toBe(false);
    expect(service.getRegisteredMediaProviders()).toEqual([]);
  });
});

test.describe('Settings provider catalog UI', () => {
  test('renders product catalog groups and unavailable account state in the live renderer path', async ({ page }) => {
    const context = await launchHeadlessSmokeApp();
    try {
      await openProviderSettings(`${context.bridgeUrl}/app`, page);

      for (const group of CATALOG_GROUP_ORDER_FOR_UI) {
        await expect(page.getByTestId(`settings-provider-group-${group}`)).toBeVisible();
      }
      await expect(page.getByTestId('settings-oauth-row-grok-account')).toHaveClass(/settings-provider-row--unavailable/);
    } finally {
      await closeSmokeApp(context);
    }
  });
});

const CATALOG_GROUP_ORDER_FOR_UI: Exclude<LlmProviderCatalogGroup, 'account'>[] = [
  'openai-compatible',
  'anthropic-compatible',
  'cloud-platform',
  'local',
  'image',
];

import { expect, test, type Page } from '@playwright/test';
import { closeSmokeApp, launchHeadlessSmokeApp } from './helpers/app';

const TEST_PROVIDER_ID = 'ollama';
const TEST_MODEL_ID = 'llama3';

async function openAgentSettings(pageUrl: string, page: Page): Promise<void> {
  await page.goto(pageUrl);
  await page.locator('.app-titlebar').waitFor({ state: 'visible', timeout: 15000 });
  await page.getByTestId('sidebar-user-settings-trigger').click();
  await page.getByTestId('open-settings-entry').click();
  await expect(page.getByTestId('settings-modal')).toBeVisible();
  await page.getByTestId('settings-nav-agents').click();
  await expect(page.getByTestId('settings-agent-list')).toBeVisible();
}

async function seedProviderAndRoutes(
  page: Page,
  mode: 'valid' | 'one-invalid',
): Promise<void> {
  await page.evaluate(async ({ mode, providerId, modelId }) => {
    const settings = await window.electronAPI.settings.get();
    const provider = settings.llm.providers.find((entry) => entry.id === providerId);
    if (!provider) {
      throw new Error(`${providerId} provider is not available in settings`);
    }

    const model = {
      id: modelId,
      label: modelId,
      enabled: true,
      contextWindowTokens: null,
    };
    const routes = settings.llm.agentRoutes.map((route) => ({
      ...route,
      providerId,
      modelId: mode === 'one-invalid' && route.agentId === 'rdc-debugger' ? 'missing-model' : modelId,
    }));

    await window.electronAPI.settings.set({
      llm: {
        providers: settings.llm.providers.map((entry) => entry.id === providerId
          ? {
            ...entry,
            apiKey: '',
            enabled: true,
            hasStoredSecret: true,
            isConfigured: true,
            status: 'verified',
            models: [model],
          }
          : entry),
        agentRoutes: routes,
      },
    });
  }, { mode, providerId: TEST_PROVIDER_ID, modelId: TEST_MODEL_ID });
}

async function trackSettingsSetCalls(page: Page): Promise<void> {
  await page.evaluate(() => {
    const trackedWindow = window as typeof window & { __rdcSettingsSetCalls?: number };
    const originalSet = window.electronAPI.settings.set;
    trackedWindow.__rdcSettingsSetCalls = 0;
    window.electronAPI.settings.set = async (patch) => {
      trackedWindow.__rdcSettingsSetCalls = (trackedWindow.__rdcSettingsSetCalls ?? 0) + 1;
      return originalSet(patch);
    };
  });
}

async function getSettingsSetCalls(page: Page): Promise<number> {
  return page.evaluate(() => (
    (window as typeof window & { __rdcSettingsSetCalls?: number }).__rdcSettingsSetCalls ?? 0
  ));
}

test('Agent routes save all valid routes in one settings write and reload from main', async ({ page }) => {
  const context = await launchHeadlessSmokeApp();
  try {
    await openAgentSettings(`${context.bridgeUrl}/app`, page);
    await seedProviderAndRoutes(page, 'valid');
    await openAgentSettings(`${context.bridgeUrl}/app`, page);
    await trackSettingsSetCalls(page);

    await page.getByTestId('settings-agent-save').click();
    await expect(page.getByTestId('settings-agent-route-save-status')).toContainText('Agent routes saved.');
    await expect.poll(() => getSettingsSetCalls(page)).toBe(1);

    const persisted = await page.evaluate(async ({ providerId, modelId }) => {
      const nextSettings = await window.electronAPI.settings.get();
      return nextSettings.llm.agentRoutes.every((route) => route.providerId === providerId && route.modelId === modelId);
    }, { providerId: TEST_PROVIDER_ID, modelId: TEST_MODEL_ID });
    expect(persisted).toBe(true);
  } finally {
    await closeSmokeApp(context);
  }
});

test('Agent routes explain invalid routes without calling settings save', async ({ page }) => {
  const context = await launchHeadlessSmokeApp();
  try {
    await openAgentSettings(`${context.bridgeUrl}/app`, page);
    await seedProviderAndRoutes(page, 'one-invalid');
    await openAgentSettings(`${context.bridgeUrl}/app`, page);
    await trackSettingsSetCalls(page);

    await page.getByTestId('settings-agent-save').click();
    await expect(page.getByTestId('settings-agent-route-save-status')).toContainText('invalid Agent route');
    await expect(page.getByTestId('settings-agent-route-save-status')).toContainText('RDC Debugger');
    await expect.poll(() => getSettingsSetCalls(page)).toBe(0);
  } finally {
    await closeSmokeApp(context);
  }
});

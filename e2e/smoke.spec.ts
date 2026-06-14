import { test, expect } from '@playwright/test';

test.describe('RDC-Agent Smoke Tests', () => {
  test('app loads and renders workbench', async ({ page }) => {
    await page.goto('http://localhost:5173');
    await expect(page.locator('[data-testid="workbench-shell"]')).toBeVisible({ timeout: 30000 });
  });

  test('composer input accepts text', async ({ page }) => {
    await page.goto('http://localhost:5173');
    const composer = page.locator('[data-testid="composer-input"]');
    await expect(composer).toBeVisible({ timeout: 30000 });
    await composer.fill('/help');
    await expect(composer).toHaveValue('/help');
  });

  test('settings modal opens', async ({ page }) => {
    await page.goto('http://localhost:5173');
    await page.click('[data-testid="settings-button"]');
    await expect(page.locator('[data-testid="settings-modal"]')).toBeVisible({ timeout: 10000 });
  });

  test('sidebar project list renders', async ({ page }) => {
    await page.goto('http://localhost:5173');
    await expect(page.locator('[data-testid="sidebar-projects"]')).toBeVisible({ timeout: 15000 });
  });
});

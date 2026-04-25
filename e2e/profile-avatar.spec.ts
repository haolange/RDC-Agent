import { test, expect, type Locator } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { launchApp, closeApp, type AppContext } from './helpers/electron-app';

const TEST_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP8z8Dwn4GBgYGJAQoAHxcCBAWwmxkAAAAASUVORK5CYII=';

const writeTestPng = (dir: string): string => {
  const avatarPath = path.join(dir, 'profile-avatar-test.png');
  fs.writeFileSync(avatarPath, Buffer.from(TEST_PNG_BASE64, 'base64'));
  return avatarPath;
};

const applyProfileSettings = async (
  ctx: AppContext,
  profile: { nickname: string; avatarPath: string },
): Promise<void> => {
  await ctx.page.evaluate(async (nextProfile) => {
    const nextSettings = await window.electronAPI.settings.set({
      profile: nextProfile,
    });
    (window as typeof window & {
      __RDC_AGENT_E2E__?: {
        setAppSettings: (settings: unknown) => void;
      };
    }).__RDC_AGENT_E2E__?.setAppSettings(nextSettings);
  }, profile);
};

const expectLoadedImage = async (locator: Locator): Promise<void> => {
  await expect(locator).toBeVisible();
  await expect.poll(async () => locator.evaluate((element) => (
    element instanceof HTMLImageElement ? element.naturalWidth : 0
  ))).toBeGreaterThan(0);
};

const openUserMenu = async (ctx: AppContext): Promise<void> => {
  await ctx.page.locator('[data-testid="sidebar-user-settings-trigger"]').click();
  await expect(ctx.page.locator('[data-testid="sidebar-user-menu"]')).toBeVisible();
};

test('profile avatar renders in settings, sidebar, and user menu', async () => {
  const ctx = await launchApp();

  try {
    const avatarPath = writeTestPng(ctx.tempDir);
    await applyProfileSettings(ctx, {
      nickname: 'CGBull',
      avatarPath,
    });

    await expectLoadedImage(ctx.page.locator('[data-testid="sidebar-user-settings-trigger"] img.footer-entry-avatar[data-avatar-kind="image"]'));

    await openUserMenu(ctx);
    await expectLoadedImage(ctx.page.locator('[data-testid="sidebar-user-menu"] img.user-menu-avatar[data-avatar-kind="image"]'));

    await ctx.page.locator('[data-testid="open-settings-entry"]').click();
    await expect(ctx.page.locator('[data-testid="settings-modal"]')).toBeVisible();
    await expectLoadedImage(ctx.page.locator('[data-testid="settings-modal"] img.settings-account-avatar[data-avatar-kind="image"]'));
  } finally {
    await closeApp(ctx);
  }
});

test('unsupported profile avatar falls back without broken images', async () => {
  const ctx = await launchApp();

  try {
    const unsupportedAvatarPath = path.join(ctx.tempDir, 'profile-avatar-test.tga');
    fs.writeFileSync(unsupportedAvatarPath, Buffer.from([0, 0, 2, 0]));
    await applyProfileSettings(ctx, {
      nickname: 'CGBull',
      avatarPath: unsupportedAvatarPath,
    });

    const sidebarTrigger = ctx.page.locator('[data-testid="sidebar-user-settings-trigger"]');
    await expect(sidebarTrigger.locator('[data-avatar-kind="fallback"]')).toHaveText('CG');
    await expect(sidebarTrigger.locator('img.footer-entry-avatar')).toHaveCount(0);

    await openUserMenu(ctx);
    await expect(ctx.page.locator('[data-testid="sidebar-user-menu"] .user-menu-avatar[data-avatar-kind="fallback"]')).toHaveText('CG');
    await expect(ctx.page.locator('[data-testid="sidebar-user-menu"] img.user-menu-avatar')).toHaveCount(0);

    await ctx.page.locator('[data-testid="open-settings-entry"]').click();
    await expect(ctx.page.locator('[data-testid="settings-modal"]')).toBeVisible();
    await expect(ctx.page.locator('[data-testid="settings-modal"] .settings-account-avatar[data-avatar-kind="fallback"]')).toHaveText('CG');
    await expect(ctx.page.locator('[data-testid="settings-modal"] img.settings-account-avatar')).toHaveCount(0);
  } finally {
    await closeApp(ctx);
  }
});

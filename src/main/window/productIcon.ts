import path from 'path';
import { app, nativeImage, nativeTheme, type BrowserWindow, type NativeImage } from 'electron';
import type { UiPreferences } from '@shared/types/settings';
import { maskLogoCircleRgba, recolorLogoRgba } from '@shared/theme/recolorLogo';
import { settingsService } from '../settings/SettingsService';
import { runtimeLogService } from '../runtime/RuntimeLogService';

let target: BrowserWindow | null = null;
let source: NativeImage | undefined;
let cached: { accent: string; image: NativeImage } | undefined;

export function activeChromeAccent(appearance: UiPreferences): string {
  const mode = appearance.theme === 'system'
    ? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light')
    : appearance.theme;
  return appearance.chromeThemes[mode].accent;
}

export function bindProductIcon(window: BrowserWindow): void {
  target = window;
  window.once('closed', () => {
    if (target === window) { target = null; source = undefined; cached = undefined; }
  });
  applyProductIcon();
}

export function applyProductIcon(): void {
  if (!target || target.isDestroyed()) return;
  try {
    const accent = activeChromeAccent(settingsService.getAll().appearance);
    if (!cached || cached.accent !== accent) {
      if (!source) {
        const logoPath = app.isPackaged
          ? path.join(process.resourcesPath, 'brand', 'rdc-agent-logo.png')
          : path.join(app.getAppPath(), 'resources', 'brand', 'rdc-agent-logo.png');
        const original = nativeImage.createFromPath(logoPath);
        if (original.isEmpty()) throw new Error('Product logo missing or invalid: ' + logoPath);
        source = original.resize({ width: 256, height: 256, quality: 'best' });
      }
      const { width, height } = source.getSize();
      // Electron's Windows bitmap is BGRA. The brand PNG is opaque RGB.
      const bitmap = source.toBitmap();
      const rgba = Uint8Array.from(bitmap);
      for (let i = 0; i < rgba.length; i += 4) [rgba[i], rgba[i + 2]] = [rgba[i + 2], rgba[i]];
      recolorLogoRgba(rgba, accent);
      maskLogoCircleRgba(rgba, width, height);
      // Native bitmaps store premultiplied channels; canvas ImageData uses straight RGBA.
      for (let i = 0; i < rgba.length; i += 4) {
        for (let c = 0; c < 3; c += 1) rgba[i + c] = Math.round(rgba[i + c] * rgba[i + 3] / 255);
      }
      for (let i = 0; i < rgba.length; i += 4) [rgba[i], rgba[i + 2]] = [rgba[i + 2], rgba[i]];
      const image = nativeImage.createFromBitmap(Buffer.from(rgba), { width, height });
      if (image.isEmpty()) throw new Error('Product icon bitmap could not be decoded.');
      cached = { accent, image };
    }
    target.setIcon(cached.image);
  } catch (error) {
    runtimeLogService.log({ scope: 'app', namespace: 'system', severity: 'warning',
      title: 'Product icon update failed', summary: error instanceof Error ? error.message : String(error) });
  }
}

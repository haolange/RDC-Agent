import { BrowserWindow, screen } from 'electron';
import type { WindowLayoutPreference } from '@shared/types/settings';
import {
  APP_DEFAULT_WINDOW_HEIGHT,
  APP_DEFAULT_WINDOW_WIDTH,
  APP_MIN_WINDOW_HEIGHT,
  APP_MIN_WINDOW_WIDTH,
} from '@shared/constants/layout';
import { settingsService } from '../settings/SettingsService';

const SAVE_DEBOUNCE_MS = 250;

let saveTimer: NodeJS.Timeout | null = null;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export function captureWindowLayout(win: BrowserWindow): WindowLayoutPreference {
  const isMaximized = win.isMaximized();
  const bounds = isMaximized ? win.getNormalBounds() : win.getBounds();
  return {
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    isMaximized,
  };
}

export function resolveWindowCreationOptions(
  saved: WindowLayoutPreference | undefined,
): {
  width: number;
  height: number;
  x?: number;
  y?: number;
  isMaximized: boolean;
} {
  const fallback: WindowLayoutPreference = {
    width: APP_DEFAULT_WINDOW_WIDTH,
    height: APP_DEFAULT_WINDOW_HEIGHT,
    x: 0,
    y: 0,
    isMaximized: false,
  };
  const candidate = saved ?? fallback;
  const display = screen.getDisplayNearestPoint({
    x: candidate.x + Math.round(candidate.width / 2),
    y: candidate.y + Math.round(candidate.height / 2),
  }).workArea;

  const width = clamp(candidate.width, APP_MIN_WINDOW_WIDTH, display.width);
  const height = clamp(candidate.height, APP_MIN_WINDOW_HEIGHT, display.height);
  const maxX = display.x + Math.max(0, display.width - width);
  const maxY = display.y + Math.max(0, display.height - height);
  const hasSavedOrigin = Boolean(saved)
    && Number.isFinite(saved!.x)
    && Number.isFinite(saved!.y)
    && (saved!.x !== 0 || saved!.y !== 0 || saved!.isMaximized);

  if (!hasSavedOrigin) {
    return {
      width,
      height,
      isMaximized: Boolean(saved?.isMaximized),
    };
  }

  return {
    width,
    height,
    x: clamp(candidate.x, display.x, maxX),
    y: clamp(candidate.y, display.y, maxY),
    isMaximized: Boolean(candidate.isMaximized),
  };
}

/** Sync persist for close path — must finish before quit. */
export function persistWindowLayout(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) return;
  try {
    settingsService.persistWindowLayout(captureWindowLayout(win));
  } catch (error) {
    console.error('[WindowLayout] Failed to persist window bounds:', error);
  }
}

/** Debounced async persist for move/resize — narrow window write only. */
export function schedulePersistWindowLayout(win: BrowserWindow | null): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
  }
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (!win || win.isDestroyed()) return;
    void settingsService.persistWindowLayoutAsync(captureWindowLayout(win)).catch((error) => {
      console.error('[WindowLayout] Failed to persist window bounds:', error);
    });
  }, SAVE_DEBOUNCE_MS);
}

export function bindWindowLayoutPersistence(win: BrowserWindow): void {
  const persistSoon = () => schedulePersistWindowLayout(win);
  win.on('resize', persistSoon);
  win.on('move', persistSoon);
  win.on('maximize', persistSoon);
  win.on('unmaximize', persistSoon);
  win.on('close', () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    persistWindowLayout(win);
  });
}

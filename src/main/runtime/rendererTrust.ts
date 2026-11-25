import { shell } from 'electron';
import { AppError } from '@shared/errors/appError';

let trustedEntry: URL | null = null;

/** Records the document the main window loads; nothing else may navigate the window or call IPC. */
export function trustRendererEntry(entryUrl: string): void {
  trustedEntry = new URL(entryUrl);
}

/**
 * A dev server is trusted by origin; a packaged build only by its exact entry file, so a dropped
 * or linked local HTML page never runs with the preload API.
 */
export function isTrustedRendererUrl(candidate: string | undefined): boolean {
  if (!trustedEntry || !candidate) return false;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return false;
  }
  if (trustedEntry.protocol === 'file:') {
    return parsed.protocol === 'file:' && parsed.pathname === trustedEntry.pathname;
  }
  return parsed.origin === trustedEntry.origin;
}

/** Account and sign-in pages are opened only over HTTPS. */
export async function openExternalHttps(url: string | undefined): Promise<void> {
  if (!url) return;
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') {
    throw new AppError('EXTERNAL_URL_REJECTED', `only https links open externally (${parsed.protocol}).`);
  }
  await shell.openExternal(parsed.href);
}

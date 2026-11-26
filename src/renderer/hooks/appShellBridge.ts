import { getElectronApi } from '../platform/getElectronApi';

export async function copyAppText(value: string): Promise<void> {
  await getElectronApi()?.appShell.copyText(value);
}

export async function openAppPath(value: string): Promise<void> {
  await getElectronApi()?.appShell.openPath(value);
}

export async function resolveFaviconDataUrl(domain: string): Promise<string | null> {
  const result = await getElectronApi()?.web.resolveFavicon(domain);
  return result?.dataUrl ?? null;
}

export type RemoteImageFetch = { dataUrl: string } | { unverified: true } | null;

/**
 * An https image an answer embeds, fetched by the main process. `unverified` means no non-model source in the session
 * supplied the URL, so nothing was requested; null means it was refused or is unavailable.
 */
export async function fetchRemoteImage(request: {
  sessionId: string;
  url: string;
  intent: 'auto' | 'click';
}): Promise<RemoteImageFetch> {
  const result = await getElectronApi()?.web.fetchImage(request);
  if (!result) return null;
  if (result.dataUrl !== null) return { dataUrl: result.dataUrl };
  return result.error === 'REMOTE_IMAGE_UNVERIFIED' ? { unverified: true } : null;
}

export function selectFiles(): Promise<string[] | null | undefined> {
  return getElectronApi()?.selectFiles() ?? Promise.resolve(undefined);
}

export async function minimizeWindow(): Promise<void> {
  await getElectronApi()?.windowControls.minimize();
}

export async function toggleMaximizeWindow(): Promise<boolean | undefined> {
  return getElectronApi()?.windowControls.toggleMaximize();
}

export async function closeWindow(): Promise<void> {
  await getElectronApi()?.windowControls.close();
}

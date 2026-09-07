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

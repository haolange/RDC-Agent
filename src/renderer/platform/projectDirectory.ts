import { getElectronApi } from './getElectronApi';

export async function browseProjectDirectory(): Promise<string | null> {
  const api = getElectronApi();
  if (!api) throw new Error('Application connection is unavailable');
  return api.selectDirectory();
}

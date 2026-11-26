import { getElectronApi } from './getElectronApi';

function api() {
  const value = getElectronApi();
  if (!value) throw new Error('Application bridge is unavailable.');
  return value;
}
export const readCrashFiles = () => api().appShell.getCrashFiles();
export const clearCrashFiles = () => api().appShell.clearCrashFiles();

import { getElectronApi } from '../../../../platform/getElectronApi';

export function getResolvedShell(executable?: string) {
  return getElectronApi()?.settings.getResolvedShell(executable ?? '');
}

import type { RdcInstallationRequest } from '@shared/types/rdcInstallation';
import { getElectronApi } from './getElectronApi';

function api() {
  const value = getElectronApi();
  if (!value) throw new Error('Application bridge is unavailable.');
  return value;
}
export const detectRdcInstallations = () => api().tool.detectInstallations();
export const selectRdcInstallation = () => api().selectDirectory();
export const resolveRdcInstallation = (request: RdcInstallationRequest) => api().tool.resolveInstallation(request);
export const validateRdcInstallation = (request: RdcInstallationRequest) => api().tool.verifyInstallation(request);

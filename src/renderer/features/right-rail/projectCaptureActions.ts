import { getElectronApi } from '../../platform/getElectronApi';

export async function importProjectInputs(projectId: string) {
  return getElectronApi()?.project.inputs.import(projectId);
}

export async function refreshProjectInputs(projectId: string) {
  return getElectronApi()?.project.inputs.refresh(projectId);
}

export async function referenceProjectInput(projectId: string, filePath: string) {
  const api = getElectronApi();
  if (!api) throw new Error('Application connection is unavailable');
  return api.project.inputs.referencePath(projectId, filePath);
}

export async function removeProjectInput(projectId: string, inputId: string) {
  const api = getElectronApi();
  if (!api) throw new Error('Application connection is unavailable');
  const prepared = await api.project.inputs.prepareRemove(projectId, inputId);
  if (!prepared) return null;
  return api.project.inputs.remove(projectId, inputId, prepared.approvalToken);
}

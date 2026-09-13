import { getElectronApi } from '../../platform/getElectronApi';

export async function importProjectInputs(projectId: string) {
  return getElectronApi()?.project.inputs.import(projectId);
}

export async function refreshProjectInputs(projectId: string) {
  return getElectronApi()?.project.inputs.refresh(projectId);
}

export async function removeProjectInput(projectId: string, inputId: string) {
  const api = getElectronApi();
  if (!api) throw new Error('Application connection is unavailable');
  const prepared = await api.project.inputs.prepareRemove(projectId, inputId);
  if (!prepared.success) {
    if (prepared.error) throw new Error(prepared.error);
    return null;
  }
  if (!prepared.approvalToken) throw new Error('Deletion approval is unavailable');
  return api.project.inputs.remove(projectId, inputId, prepared.approvalToken);
}

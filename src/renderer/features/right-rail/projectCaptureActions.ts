import { getElectronApi } from '../../platform/getElectronApi';

export async function importProjectInputs(projectId: string) {
  return getElectronApi()?.project.inputs.import(projectId);
}

export async function refreshProjectInputs(projectId: string) {
  return getElectronApi()?.project.inputs.refresh(projectId);
}

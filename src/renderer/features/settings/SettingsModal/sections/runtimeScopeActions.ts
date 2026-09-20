import type { RdcRuntimeOverview } from '@shared/types/rdcRuntime';
import { getElectronApi } from '../../../../platform/getElectronApi';

const rdcRuntime = () => getElectronApi()?.rdcRuntime;

export async function validateScopedResource(
  request: Parameters<NonNullable<ReturnType<typeof rdcRuntime>>['validateResource']>[0],
) {
  return rdcRuntime()?.validateResource(request);
}

export async function upsertScopedResource(
  request: Parameters<NonNullable<ReturnType<typeof rdcRuntime>>['upsertResource']>[0],
) {
  return getElectronApi()?.rdcRuntime.upsertResource(request);
}

export async function deleteScopedResource(
  kind: Parameters<NonNullable<ReturnType<typeof rdcRuntime>>['deleteResource']>[0],
  scope: Parameters<NonNullable<ReturnType<typeof rdcRuntime>>['deleteResource']>[1],
  id: string,
  projectRoot?: string,
): Promise<RdcRuntimeOverview | undefined> {
  return getElectronApi()?.rdcRuntime.deleteResource(kind, scope, id, projectRoot);
}

export async function revealResourceLocation(sourcePath: string): Promise<void> {
  await rdcRuntime()?.revealResource(sourcePath);
}

export async function importScopedResource(
  request: Parameters<NonNullable<ReturnType<typeof rdcRuntime>>['importResource']>[0],
) {
  return rdcRuntime()?.importResource(request);
}

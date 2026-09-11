import type { RdxRuntimeOverview } from '@shared/types/rdxRuntime';
import { getElectronApi } from '../../../../platform/getElectronApi';

const rdxRuntime = () => getElectronApi()?.rdxRuntime;

export async function validateScopedResource(
  request: Parameters<NonNullable<ReturnType<typeof rdxRuntime>>['validateResource']>[0],
) {
  return rdxRuntime()?.validateResource(request);
}

export async function upsertScopedResource(
  request: Parameters<NonNullable<ReturnType<typeof rdxRuntime>>['upsertResource']>[0],
) {
  return getElectronApi()?.rdxRuntime.upsertResource(request);
}

export async function deleteScopedResource(
  kind: Parameters<NonNullable<ReturnType<typeof rdxRuntime>>['deleteResource']>[0],
  scope: Parameters<NonNullable<ReturnType<typeof rdxRuntime>>['deleteResource']>[1],
  id: string,
  projectRoot?: string,
): Promise<RdxRuntimeOverview | undefined> {
  return getElectronApi()?.rdxRuntime.deleteResource(kind, scope, id, projectRoot);
}

export async function revealResourceLocation(sourcePath: string): Promise<void> {
  await rdxRuntime()?.revealResource(sourcePath);
}

export async function importScopedResource(
  request: Parameters<NonNullable<ReturnType<typeof rdxRuntime>>['importResource']>[0],
) {
  return rdxRuntime()?.importResource(request);
}

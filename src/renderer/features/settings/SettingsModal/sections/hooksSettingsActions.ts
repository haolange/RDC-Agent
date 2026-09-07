import type { RdxRuntimeOverview } from '@shared/types/rdxRuntime';
import { getElectronApi } from '../../../../platform/getElectronApi';

const runtime = () => getElectronApi()?.rdxRuntime;

export async function trustHook(projectRoot: string | null | undefined, hookId: string): Promise<RdxRuntimeOverview | undefined> {
  return runtime()?.trustHook(projectRoot ?? undefined, hookId);
}

export async function revokeHook(projectRoot: string | null | undefined, hookId: string): Promise<RdxRuntimeOverview | undefined> {
  return runtime()?.revokeHook(projectRoot ?? undefined, hookId);
}

export async function getRdxOverview(projectRoot: string): Promise<RdxRuntimeOverview | undefined> {
  return runtime()?.getOverview(projectRoot);
}

export async function testHook(
  event: Parameters<NonNullable<ReturnType<typeof runtime>>['testHook']>[0],
  projectRoot: string | undefined,
  hookId: string,
) {
  return runtime()?.testHook(event, projectRoot, hookId);
}

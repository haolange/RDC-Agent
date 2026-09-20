import type { RdcRuntimeOverview } from '@shared/types/rdcRuntime';
import { getElectronApi } from '../../../../platform/getElectronApi';

const runtime = () => getElectronApi()?.rdcRuntime;

export async function trustHook(projectRoot: string | null | undefined, hookId: string): Promise<RdcRuntimeOverview | undefined> {
  return runtime()?.trustHook(projectRoot ?? undefined, hookId);
}

export async function revokeHook(projectRoot: string | null | undefined, hookId: string): Promise<RdcRuntimeOverview | undefined> {
  return runtime()?.revokeHook(projectRoot ?? undefined, hookId);
}

export async function getRdcOverview(projectRoot: string): Promise<RdcRuntimeOverview | undefined> {
  return runtime()?.getOverview(projectRoot);
}

export async function testHook(
  event: Parameters<NonNullable<ReturnType<typeof runtime>>['testHook']>[0],
  projectRoot: string | undefined,
  hookId: string,
) {
  return runtime()?.testHook(event, projectRoot, hookId);
}

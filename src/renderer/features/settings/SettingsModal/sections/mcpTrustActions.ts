import type { RdxRuntimeOverview } from '@shared/types/rdxRuntime';
import { getElectronApi } from '../../../../platform/getElectronApi';

export async function trustMcp(projectRoot: string, descriptorId: string): Promise<RdxRuntimeOverview | undefined> {
  return getElectronApi()?.rdxRuntime.trustMcp(projectRoot, descriptorId);
}

export async function revokeMcp(projectRoot: string, descriptorId: string): Promise<RdxRuntimeOverview | undefined> {
  return getElectronApi()?.rdxRuntime.revokeMcp(projectRoot, descriptorId);
}

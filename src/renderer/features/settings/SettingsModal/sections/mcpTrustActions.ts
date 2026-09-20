import type { RdcRuntimeOverview } from '@shared/types/rdcRuntime';
import { getElectronApi } from '../../../../platform/getElectronApi';

export async function trustMcp(projectRoot: string, descriptorId: string): Promise<RdcRuntimeOverview | undefined> {
  return getElectronApi()?.rdcRuntime.trustMcp(projectRoot, descriptorId);
}

export async function revokeMcp(projectRoot: string, descriptorId: string): Promise<RdcRuntimeOverview | undefined> {
  return getElectronApi()?.rdcRuntime.revokeMcp(projectRoot, descriptorId);
}

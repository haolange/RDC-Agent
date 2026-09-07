import type { MCPServerStatusSummary } from '@shared/types/mcp';
import { getElectronApi } from '../../../../platform/getElectronApi';

export async function getMcpStatusSummary(): Promise<MCPServerStatusSummary[] | undefined> {
  return getElectronApi()?.mcp?.getStatusSummary();
}

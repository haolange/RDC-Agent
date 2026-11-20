import { getElectronApi } from '../../../../platform/getElectronApi';
import type { MCPServerStatusSummary } from '@shared/types/mcp';

export async function getMcpStatusSummary(): Promise<MCPServerStatusSummary[] | undefined> {
  return getElectronApi()?.mcp?.getStatusSummary();
}

import { getElectronApi } from './getElectronApi';
import type { RendererFaultReport } from '@shared/types/lifecycle';

/** Hands a caught render-time exception to main for the lifecycle ledger; a missing bridge has nowhere to send it. */
export async function reportRendererFault(report: RendererFaultReport): Promise<void> {
  await getElectronApi()?.appShell.reportRendererFault(report);
}

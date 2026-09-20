import type { RdcCliInvokerSettings } from './settings';

export interface RdcInstallationCandidate {
  root: string;
  source: 'configured' | 'default';
  problem?: string;
}

export interface RdcInstallationRequest {
  root: string;
  timeoutMs: RdcCliInvokerSettings['timeoutMs'];
  env: RdcCliInvokerSettings['env'];
}

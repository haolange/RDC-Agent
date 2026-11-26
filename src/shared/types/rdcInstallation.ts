import type { RdcCliInvokerSettings } from './settings';

export interface RdcInstallationCandidate {
  root: string;
  source: 'configured' | 'default';
  problem?: string;
}

export interface RdcInstallationRequest {
  root: string;
  noProgressTimeoutMs: RdcCliInvokerSettings['noProgressTimeoutMs'];
  env: RdcCliInvokerSettings['env'];
}

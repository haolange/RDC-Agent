import type { LlmModelCapabilityProbeRequest, LlmModelCapabilityProbeResult } from './settings';

export interface ProviderProbeBatchRequest {
  providerIds?: string[];
  retryRunId?: string;
}

export interface ProviderProbeBatchItem extends LlmModelCapabilityProbeRequest {
  state: 'pending' | 'running' | 'settled' | 'skipped' | 'cancelled';
  result?: LlmModelCapabilityProbeResult;
  detail?: string;
}

/** One in-memory, explicitly requested batch; credentials never cross this boundary. */
export interface ProviderProbeBatch {
  id: string;
  revision: number;
  state: 'ready' | 'running' | 'cancelling' | 'completed' | 'cancelled';
  items: ProviderProbeBatchItem[];
  modelCount: number;
  requestCount: number;
  discoveryErrors: { providerId: string; detail: string }[];
}

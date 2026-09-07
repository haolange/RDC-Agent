import type { EffectiveCatalogSnapshot } from '@shared/types/providerCapability';
import type { LlmModelCapabilityProbeMode } from '@shared/types/settings';
import { getElectronApi } from '../../../../platform/getElectronApi';

export function getEffectiveCatalog(providerId: string, accountId: string) {
  return getElectronApi()?.settings.getEffectiveCatalog(providerId, accountId);
}

export function subscribeEffectiveCatalogChanged(
  listener: (snapshot: EffectiveCatalogSnapshot) => void,
) {
  return getElectronApi()?.events.onEffectiveCatalogChanged(listener);
}

export function testModelCapability(request: {
  providerId: string;
  modelId: string;
  mode: LlmModelCapabilityProbeMode;
}) {
  return getElectronApi()?.llm.testModelCapability(request);
}

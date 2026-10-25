import type { LlmModelCapabilityProbeMode } from '@shared/types/settings';
import { getElectronApi } from '../../../../platform/getElectronApi';

export function testModelCapability(request: {
  providerId: string;
  modelId: string;
  mode: LlmModelCapabilityProbeMode;
}) {
  return getElectronApi()?.llm.testModelCapability(request);
}

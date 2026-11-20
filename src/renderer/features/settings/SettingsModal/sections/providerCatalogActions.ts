import { getElectronApi } from '../../../../platform/getElectronApi';
import type { LlmModelCapabilityProbeMode } from '@shared/types/settings';

export function testModelCapability(request: {
  providerId: string;
  modelId: string;
  mode: LlmModelCapabilityProbeMode;
}) {
  return getElectronApi()?.llm.testModelCapability(request);
}

import type { RdcCliInvokerSettings } from '@shared/types/settings';
import { appPathService } from '../runtime/AppPathService';

export const RDC_INTERMEDIATE_ROOT_ENV = 'RDC_TOOL_INTERMEDIATE_ROOT';

export function hostRdcIntermediateRoot(): string {
  return appPathService.getUserRdcPaths().rdcIntermediateRoot;
}

export function withRdcHostRuntimeEnv(settings: RdcCliInvokerSettings): RdcCliInvokerSettings {
  const env = { ...settings.env };
  if (!env[RDC_INTERMEDIATE_ROOT_ENV]?.trim()) {
    env[RDC_INTERMEDIATE_ROOT_ENV] = hostRdcIntermediateRoot();
  }
  return { ...settings, env };
}

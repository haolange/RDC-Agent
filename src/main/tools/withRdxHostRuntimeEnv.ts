import type { RdxCliInvokerSettings } from '@shared/types/settings';
import { appPathService } from '../runtime/AppPathService';

export const RDX_INTERMEDIATE_ROOT_ENV = 'RDX_INTERMEDIATE_ROOT';

export function hostRdxIntermediateRoot(): string {
  return appPathService.getUserRdxPaths().rdxIntermediateRoot;
}

export function withRdxHostRuntimeEnv(settings: RdxCliInvokerSettings): RdxCliInvokerSettings {
  const env = { ...settings.env };
  if (!env[RDX_INTERMEDIATE_ROOT_ENV]?.trim()) {
    env[RDX_INTERMEDIATE_ROOT_ENV] = hostRdxIntermediateRoot();
  }
  return { ...settings, env };
}

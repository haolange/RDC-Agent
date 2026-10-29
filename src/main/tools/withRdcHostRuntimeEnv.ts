import type { RdcCliInvokerSettings } from '@shared/types/settings';
import { appPathService } from '../runtime/AppPathService';
import { configuredInstallationRoot } from './RdcInstallationService';

export const RDC_INTERMEDIATE_ROOT_ENV = 'RDC_TOOL_INTERMEDIATE_ROOT';

export function hostRdcIntermediateRoot(): string {
  return appPathService.getUserRdcPaths().rdcIntermediateRoot;
}

export function withRdcHostRuntimeEnv(settings: RdcCliInvokerSettings): RdcCliInvokerSettings {
  const env = { ...settings.env };
  const root = configuredInstallationRoot(settings);
  if (root) env.RDC_TOOL_ROOT = root;
  for (const key of ['RDC_TOOL_ANDROID_ADB_PATH', 'RDC_TOOL_SPIRV_TOOLS_PATH']) {
    env[key] ??= process.env[key] ?? '';
  }
  if (!env[RDC_INTERMEDIATE_ROOT_ENV]?.trim()) {
    env[RDC_INTERMEDIATE_ROOT_ENV] = hostRdcIntermediateRoot();
  }
  return { ...settings, env };
}

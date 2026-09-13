import { getElectronApi } from './getElectronApi';
import type { RdxCliInvokerSettings } from '@shared/types/settings';
import type { ToolRuntimeSummary } from '@shared/types/tool';

export async function validateRdxInstallation(draft: RdxCliInvokerSettings): Promise<ToolRuntimeSummary | null> {
  const api = getElectronApi();
  if (!api) throw new Error('Application bridge is unavailable.');
  const saved = (await api.settings.get()).tooling.rdxCli;
  if (saved.enabled !== draft.enabled || saved.command !== draft.command
    || saved.workingDirectory !== draft.workingDirectory || saved.timeoutMs !== draft.timeoutMs
    || JSON.stringify(saved.argsPrefix) !== JSON.stringify(draft.argsPrefix)
    || Object.keys({ ...saved.env, ...draft.env }).some(key => saved.env[key] !== draft.env[key])) return null;
  return api.tool.getRuntimeSummary();
}

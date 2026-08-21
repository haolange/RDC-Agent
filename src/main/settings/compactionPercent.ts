import type { AppSettings } from '@shared/types/settings';
import { DEFAULT_CONTEXT_COMPACTION_PERCENT } from '@shared/types/modelCapability';
import { resolveEffectiveCompactionPercent } from '@shared/utils/contextBudget';
import { compileEffectivePolicy } from '../agent-runtime/permissions/PolicyCompiler';
import { storageAdapter } from '../sessions/StorageAdapter';
import { settingsService } from './SettingsService';

export function resolveCompactionPercentForSettings(
  settings: AppSettings,
  projectRootPath?: string | null,
): number {
  const policy = compileEffectivePolicy(projectRootPath ?? null);
  return resolveEffectiveCompactionPercent(
    settings.agentRuntime.context?.compactionThresholdPercent ?? DEFAULT_CONTEXT_COMPACTION_PERCENT,
    policy.contextCompactionPercent,
  );
}

export function resolveCompactionPercentForSession(sessionId?: string | null): number {
  const settings = settingsService.getAll();
  const session = sessionId ? storageAdapter.readSession(sessionId) : null;
  const project = session ? storageAdapter.getProjectById(session.projectId) : null;
  return resolveCompactionPercentForSettings(settings, project?.rootPath ?? null);
}

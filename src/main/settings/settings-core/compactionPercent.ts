import { resolveEffectiveCompactionPercent } from '@shared/utils/contextBudget';
import { compileEffectivePolicy } from '../../agent-runtime/permissions/PolicyCompiler';
import { storageAdapter } from '../../sessions/store/StorageAdapter';
import { settingsService } from './SettingsService';

/** The compaction threshold a turn uses: the user's setting, tightened by the project policy. */
export function resolveCompactionPercentForProject(projectRootPath?: string | null): number {
  const policy = compileEffectivePolicy(projectRootPath ?? null);
  return resolveEffectiveCompactionPercent(
    settingsService.snapshot().user.agentRuntime.context.compactionThresholdPercent,
    policy.contextCompactionPercent,
  );
}

export function resolveCompactionPercentForSession(sessionId?: string | null): number {
  const session = sessionId ? storageAdapter.readSession(sessionId) : null;
  const project = session ? storageAdapter.getProjectById(session.projectId) : null;
  return resolveCompactionPercentForProject(project?.rootPath ?? null);
}

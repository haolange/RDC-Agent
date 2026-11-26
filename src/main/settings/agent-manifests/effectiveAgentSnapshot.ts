/** The enabled profile of one Agent in the current effective manifest snapshot (user + project scopes). */

import { appPathService } from '../../runtime/AppPathService';
import { agentManifestService } from './AgentManifestService';

export function resolveEffectiveAgentSnapshot(agentId: string, projectRootPath?: string | null) {
  const snapshot = agentManifestService.resolveEffectiveSnapshot(
    appPathService.getRuntimePaths(),
    projectRootPath ?? undefined,
  );
  const profile = snapshot.profiles.find((entry) => entry.id === agentId && entry.enabled) ?? null;
  return {
    profile,
    overlayDiagnostics: snapshot.diagnostics.filter((entry) => entry.agentId === agentId && entry.scope !== 'builtin'),
    diagnostics: snapshot.diagnostics,
  };
}

export function resolveEnabledAgentDefinition(agentId: string, projectRootPath?: string | null) {
  return resolveEffectiveAgentSnapshot(agentId, projectRootPath).profile;
}

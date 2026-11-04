import type { AgentManifestDiagnostic } from '../types/agentManifest';

export function formatAgentManifestDiagnostic(issue: AgentManifestDiagnostic): string {
  return `[${issue.scope}/${issue.agentId}] ${issue.sourcePath}\n${issue.code}: ${issue.message}`;
}

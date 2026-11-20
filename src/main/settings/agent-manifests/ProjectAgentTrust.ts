import { fileIdentity } from '../../runtime/fileIdentity';
import { hashScopedResource } from '../../runtime/ScopedResourceResolver';
import { ProjectTrustStore } from '../settings-core/ProjectTrustStore';

/**
 * A project Agent profile changes instructions, tools and delegation for every turn in that project,
 * so one that arrived with the project (clone, pull, unzip) loads only after the user trusts its exact
 * bytes. Profiles the user saves through Settings are trusted as written.
 */
export class ProjectAgentTrust {
  private readonly store: ProjectTrustStore;

  constructor(explicitStorePath?: string) {
    this.store = new ProjectTrustStore('agent-trust.json', explicitStorePath);
  }

  isTrusted(projectRoot: string, agentId: string, sourcePath: string): boolean {
    return this.store.isTrusted(projectRoot, agentId, projectAgentFingerprint(sourcePath));
  }

  trust(projectRoot: string, agentId: string, sourcePath: string): void {
    this.store.trust(projectRoot, agentId, projectAgentFingerprint(sourcePath));
  }

  revoke(projectRoot: string, agentId: string): void {
    this.store.revoke(projectRoot, agentId);
  }
}

function projectAgentFingerprint(sourcePath: string): string {
  return hashScopedResource({ kind: 'project-agent-trust', file: fileIdentity(sourcePath) });
}

export const projectAgentTrust = new ProjectAgentTrust();

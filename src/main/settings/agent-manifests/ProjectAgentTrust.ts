import path from 'path';
import { appPathService } from '../../runtime/AppPathService';
import { canonicalRealpath, fileIdentity } from '../../runtime/fileIdentity';
import { TrustStore } from '../../runtime/TrustStore';
import { hashScopedResource } from '../../runtime/ScopedResourceResolver';

/**
 * A project Agent profile changes instructions, tools and delegation for every turn in that project,
 * so one that arrived with the project (clone, pull, unzip) loads only after the user trusts its exact
 * bytes. Profiles the user saves through Settings are trusted as written.
 */
export class ProjectAgentTrust {
  private readonly store: TrustStore;

  constructor(explicitStorePath?: string) {
    this.store = new TrustStore(() => explicitStorePath ?? path.join(appPathService.getAppStatePaths().appStateRoot, 'agent-trust.json'));
  }

  isTrusted(projectRoot: string, agentId: string, sourcePath: string): boolean {
    return this.store.isTrusted('project', canonicalRealpath(projectRoot), agentId, projectAgentFingerprint(sourcePath));
  }

  trust(projectRoot: string, agentId: string, sourcePath: string): void {
    this.store.trust('project', canonicalRealpath(projectRoot), agentId, projectAgentFingerprint(sourcePath));
  }

  revoke(projectRoot: string, agentId: string): void {
    const owner = canonicalRealpath(projectRoot).toLowerCase();
    this.store.revoke((record) => record.ownerRealpath.toLowerCase() === owner && record.resourceId === agentId);
  }
}

function projectAgentFingerprint(sourcePath: string): string {
  return hashScopedResource({ kind: 'project-agent-trust', file: fileIdentity(sourcePath) });
}

export const projectAgentTrust = new ProjectAgentTrust();

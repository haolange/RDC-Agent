import path from 'path';
import { appPathService } from '../../runtime/AppPathService';
import { canonicalRealpath, fileIdentity } from '../../runtime/fileIdentity';
import { TrustStore } from '../../runtime/TrustStore';
import { hashScopedResource } from '../../runtime/ScopedResourceResolver';
import { fileStamp } from '../../runtime/externalInput';

/**
 * A project Agent profile changes instructions, tools and delegation for every turn in that project,
 * so one that arrived with the project (clone, pull, unzip) loads only after the user trusts its exact
 * bytes. Profiles the user saves through Settings are trusted as written.
 */
export class ProjectAgentTrust {
  private readonly store: TrustStore;
  private readonly storePath: () => string;
  private revisionValue = 0;

  constructor(explicitStorePath?: string) {
    this.storePath = () => explicitStorePath ?? path.join(appPathService.getAppStatePaths().appStateRoot, 'agent-trust.json');
    this.store = new TrustStore(this.storePath);
  }

  /** Changes with every trust decision made through the app. */
  get revision(): number {
    return this.revisionValue;
  }

  /** Stamp of the trust file, so a decision edited outside the app is noticed when inputs are re-checked. */
  stamp(): string {
    return fileStamp(this.storePath());
  }

  isTrusted(projectRoot: string, agentId: string, sourcePath: string): boolean {
    return this.store.isTrusted('project', canonicalRealpath(projectRoot), agentId, projectAgentFingerprint(sourcePath));
  }

  trust(projectRoot: string, agentId: string, sourcePath: string): void {
    this.store.trust('project', canonicalRealpath(projectRoot), agentId, projectAgentFingerprint(sourcePath));
    this.revisionValue += 1;
  }

  revoke(projectRoot: string, agentId: string): void {
    const owner = canonicalRealpath(projectRoot).toLowerCase();
    this.store.revoke((record) => record.ownerRealpath.toLowerCase() === owner && record.resourceId === agentId);
    this.revisionValue += 1;
  }
}

function projectAgentFingerprint(sourcePath: string): string {
  return hashScopedResource({ kind: 'project-agent-trust', file: fileIdentity(sourcePath) });
}

export const projectAgentTrust = new ProjectAgentTrust();

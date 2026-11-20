import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { appPathService } from '../../runtime/AppPathService';
import { canonicalRealpath } from '../../runtime/fileIdentity';

const ProjectTrustRecordSchema = z.object({
  projectRealpath: z.string().min(1),
  resourceId: z.string().min(1),
  trustFingerprint: z.string().min(1),
  trustedAt: z.string().min(1),
}).strict();

export type ProjectTrustRecord = z.infer<typeof ProjectTrustRecordSchema>;

const ProjectTrustFileSchema = z.record(z.string(), ProjectTrustRecordSchema);

/**
 * Trust decisions for resources a project brings with it (MCP servers, Agent profiles). Each record
 * binds one resource id in one real project directory to a fingerprint; any other fingerprint is
 * untrusted. A file in another shape is read as empty, so the user is asked again.
 */
export class ProjectTrustStore {
  constructor(
    private readonly fileName: string,
    private readonly explicitStorePath?: string,
  ) {}

  private get storePath(): string {
    return this.explicitStorePath ?? path.join(appPathService.getAppStatePaths().appStateRoot, this.fileName);
  }

  resolveProjectRealpath(projectRoot: string): string {
    return canonicalRealpath(projectRoot);
  }

  isTrusted(projectRoot: string, resourceId: string, trustFingerprint: string): boolean {
    const projectRealpath = this.resolveProjectRealpath(projectRoot);
    const record = this.read()[this.key(projectRealpath, resourceId)];
    return Boolean(record && record.projectRealpath === projectRealpath && record.trustFingerprint === trustFingerprint);
  }

  trust(projectRoot: string, resourceId: string, trustFingerprint: string): ProjectTrustRecord {
    const projectRealpath = this.resolveProjectRealpath(projectRoot);
    const store = this.read();
    const record: ProjectTrustRecord = { projectRealpath, resourceId, trustFingerprint, trustedAt: new Date().toISOString() };
    store[this.key(projectRealpath, resourceId)] = record;
    this.write(store);
    return record;
  }

  revoke(projectRoot: string, resourceId: string): void {
    const projectRealpath = this.resolveProjectRealpath(projectRoot);
    const store = this.read();
    delete store[this.key(projectRealpath, resourceId)];
    this.write(store);
  }

  private key(projectRealpath: string, resourceId: string): string {
    return `${projectRealpath.toLowerCase()}::${resourceId}`;
  }

  private read(): Record<string, ProjectTrustRecord> {
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(this.storePath, 'utf8'));
    } catch {
      return {};
    }
    const parsed = ProjectTrustFileSchema.safeParse(raw);
    return parsed.success ? parsed.data : {};
  }

  private write(store: Record<string, ProjectTrustRecord>): void {
    fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
    fs.writeFileSync(this.storePath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  }
}

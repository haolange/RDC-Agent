import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { appPathService } from '../../runtime/AppPathService';
import { agentManifestService } from '../agent-manifests/AgentManifestService';
import { AGENT_MANIFEST_FIELD_MOVED, parseAgentMarkdownStrict } from '../agent-manifests/agentManifestParse';
import { planAgentModelFieldMigration } from '../agent-manifests/agentModelFieldMigration';
import { projectAgentTrust } from '../agent-manifests/ProjectAgentTrust';
import { resolveRegisteredProjectRoot, tryCurrentProjectRoot } from './resolveRegisteredProjectRoot';
import { AGENT_PROJECT_UNTRUSTED } from '@shared/types/agentManifest';
import type { AppSettings, AppSettingsPatch } from '@shared/types/settings';
import type {
  AgentBuiltinComparison,
  AgentDefinitionCommitQuery,
  AgentModelMigrationPreview,
  AgentOverrideFileRequest,
  ProjectAgentTrustPreview,
} from '@shared/types/agentManifest';

interface SettingsAccess {
  getAll(): AppSettings;
  setAll(patch: AppSettingsPatch): AppSettings;
}

/** User-triggered actions on override files that do not apply as written. */
export class SettingsAgentOverrideOps {
  constructor(private readonly settings: SettingsAccess) {}

  private resolveMovedFieldOverride(request: Pick<AgentOverrideFileRequest, 'sourcePath'> & { sourceHash?: string }) {
    const target = agentManifestService.resolveDiagnosedOverride(
      appPathService.getRuntimePaths(),
      request.sourcePath,
      AGENT_MANIFEST_FIELD_MOVED,
      tryCurrentProjectRoot(),
    );
    if (request.sourceHash !== undefined && request.sourceHash !== target.sourceHash) {
      throw new Error('AGENT_OVERRIDE_CHANGED: the file changed after it was reviewed; open the preview again.');
    }
    return target;
  }

  previewModelMigration(sourcePath: string): AgentModelMigrationPreview {
    const target = this.resolveMovedFieldOverride({ sourcePath });
    const plan = planAgentModelFieldMigration(fs.readFileSync(target.sourcePath, 'utf8'));
    const currentBinding = this.settings.getAll().agentModels.byAgent[target.agentId] ?? {};
    return {
      sourcePath: target.sourcePath,
      sourceHash: target.sourceHash,
      agentId: target.agentId,
      scope: target.scope,
      binding: { ...currentBinding, ...plan.binding },
      currentBinding,
      droppedHandoffModels: plan.droppedHandoffModels,
      ignoredValues: plan.ignoredValues,
      backupPath: `${target.sourcePath}.bak`,
    };
  }

  /** Backup → Settings binding → manifest without the moved fields, replaced atomically. */
  async applyModelMigration(request: AgentOverrideFileRequest): Promise<AppSettings> {
    const target = this.resolveMovedFieldOverride(request);
    const raw = await fs.promises.readFile(target.sourcePath, 'utf8');
    const plan = planAgentModelFieldMigration(raw);
    const migrated = parseAgentMarkdownStrict(plan.content, target.sourcePath, target.agentId, new Date().toISOString(), false);
    if (!migrated.ok) {
      throw new Error(`AGENT_MODEL_MIGRATION_STILL_INVALID: ${migrated.reason}`);
    }
    await fs.promises.writeFile(`${target.sourcePath}.bak`, raw, 'utf8');
    const agentModels = this.settings.getAll().agentModels;
    this.settings.setAll({
      agentModels: {
        ...agentModels,
        byAgent: { ...agentModels.byAgent, [target.agentId]: { ...agentModels.byAgent[target.agentId], ...plan.binding } },
      },
    });
    const temporaryPath = `${target.sourcePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await fs.promises.writeFile(temporaryPath, plan.content, 'utf8');
      await fs.promises.rename(temporaryPath, target.sourcePath);
    } finally {
      await fs.promises.rm(temporaryPath, { force: true });
    }
    return this.settings.getAll();
  }

  async deleteOverrideFile(request: AgentOverrideFileRequest): Promise<AppSettings> {
    const target = this.resolveMovedFieldOverride(request);
    await fs.promises.rm(target.sourcePath);
    return this.settings.getAll();
  }

  previewProjectAgentTrust(sourcePath: string): ProjectAgentTrustPreview {
    const { target } = this.resolveUntrustedProjectAgent({ sourcePath });
    return {
      agentId: target.agentId,
      sourcePath: target.sourcePath,
      sourceHash: target.sourceHash,
      content: fs.readFileSync(target.sourcePath, 'utf8'),
    };
  }

  /** Trusts the reviewed bytes only; a file edited after the preview needs a new review. */
  trustProjectAgent(request: AgentOverrideFileRequest): AppSettings {
    const { target, projectRoot } = this.resolveUntrustedProjectAgent(request);
    projectAgentTrust.trust(projectRoot, target.agentId, target.sourcePath);
    return this.settings.getAll();
  }

  private resolveUntrustedProjectAgent(request: Pick<AgentOverrideFileRequest, 'sourcePath'> & { sourceHash?: string }) {
    const projectRoot = tryCurrentProjectRoot();
    if (!projectRoot) throw new Error('AGENT_PROJECT_ROOT_REQUIRED: open the project that owns this Agent profile.');
    const target = agentManifestService.resolveDiagnosedOverride(
      appPathService.getRuntimePaths(),
      request.sourcePath,
      AGENT_PROJECT_UNTRUSTED,
      projectRoot,
    );
    if (request.sourceHash !== undefined && request.sourceHash !== target.sourceHash) {
      throw new Error('AGENT_OVERRIDE_CHANGED: the file changed after it was reviewed; open the preview again.');
    }
    return { target, projectRoot };
  }

  getBuiltinComparison(query: AgentDefinitionCommitQuery): AgentBuiltinComparison {
    return agentManifestService.readBuiltinComparison(
      appPathService.getRuntimePaths(),
      query.agentId,
      query.scope === 'project' ? resolveRegisteredProjectRoot(query.projectId) : undefined,
    );
  }
}

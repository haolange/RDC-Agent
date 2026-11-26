import fs from 'node:fs';
import { AGENT_PROJECT_UNTRUSTED } from '@shared/types/agentManifest';
import { AppError } from '@shared/errors/appError';
import { appPathService } from '../../runtime/AppPathService';
import { agentManifestService } from '../agent-manifests/AgentManifestService';
import { AGENT_MANIFEST_FIELD_MOVED, parseAgentMarkdownStrict } from '../agent-manifests/agentManifestParse';
import { planAgentModelFieldMigration } from '../agent-manifests/agentModelFieldMigration';
import { projectAgentTrust } from '../agent-manifests/ProjectAgentTrust';
import { writeFileAtomic } from '../../runtime/atomicFile';
import { resolveRegisteredProjectRoot, tryCurrentProjectRoot } from './resolveRegisteredProjectRoot';
import type { SettingsSnapshot } from './settingsStore';
import type { SettingsPatchOp, SettingsPatchResult } from '@shared/types/settings';
import type {
  AgentBuiltinComparison,
  AgentDefinitionCommitQuery,
  AgentModelMigrationPreview,
  AgentOverrideFileRequest,
  ProjectAgentTrustPreview,
} from '@shared/types/agentManifest';

interface SettingsAccess {
  snapshot(): SettingsSnapshot;
  update(ops: readonly SettingsPatchOp[]): SettingsPatchResult;
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
      throw new AppError('AGENT_OVERRIDE_CHANGED', 'the file changed after it was reviewed; open the preview again.');
    }
    return target;
  }

  previewModelMigration(sourcePath: string): AgentModelMigrationPreview {
    const target = this.resolveMovedFieldOverride({ sourcePath });
    const plan = planAgentModelFieldMigration(fs.readFileSync(target.sourcePath, 'utf8'));
    const currentBinding = this.settings.snapshot().user.agentModels.byAgent[target.agentId] ?? {};
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
  async applyModelMigration(request: AgentOverrideFileRequest): Promise<void> {
    const target = this.resolveMovedFieldOverride(request);
    const raw = await fs.promises.readFile(target.sourcePath, 'utf8');
    const plan = planAgentModelFieldMigration(raw);
    const migrated = parseAgentMarkdownStrict(
      plan.content,
      target.sourcePath,
      target.agentId,
      new Date().toISOString(),
      false,
    );
    if (!migrated.ok) {
      throw new AppError('AGENT_MODEL_MIGRATION_STILL_INVALID', migrated.reason);
    }
    await writeFileAtomic(`${target.sourcePath}.bak`, raw);
    const fields: SettingsPatchOp[] = [];
    if (plan.binding.model)
      fields.push({
        op: 'agentModels.setAgentField',
        agentId: target.agentId,
        field: 'model',
        value: plan.binding.model,
      });
    if (plan.binding.reasoningLevel) {
      fields.push({
        op: 'agentModels.setAgentField',
        agentId: target.agentId,
        field: 'reasoningLevel',
        value: plan.binding.reasoningLevel,
      });
    }
    if (fields.length > 0) this.settings.update(fields);
    await writeFileAtomic(target.sourcePath, plan.content);
    agentManifestService.invalidate();
  }

  async deleteOverrideFile(request: AgentOverrideFileRequest): Promise<void> {
    const target = this.resolveMovedFieldOverride(request);
    await fs.promises.rm(target.sourcePath);
    agentManifestService.invalidate();
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
  trustProjectAgent(request: AgentOverrideFileRequest): void {
    const { target, projectRoot } = this.resolveUntrustedProjectAgent(request);
    projectAgentTrust.trust(projectRoot, target.agentId, target.sourcePath);
  }

  private resolveUntrustedProjectAgent(
    request: Pick<AgentOverrideFileRequest, 'sourcePath'> & { sourceHash?: string },
  ) {
    const projectRoot = tryCurrentProjectRoot();
    if (!projectRoot)
      throw new AppError('AGENT_PROJECT_ROOT_REQUIRED', 'open the project that owns this Agent profile.');
    const target = agentManifestService.resolveDiagnosedOverride(
      appPathService.getRuntimePaths(),
      request.sourcePath,
      AGENT_PROJECT_UNTRUSTED,
      projectRoot,
    );
    if (request.sourceHash !== undefined && request.sourceHash !== target.sourceHash) {
      throw new AppError('AGENT_OVERRIDE_CHANGED', 'the file changed after it was reviewed; open the preview again.');
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

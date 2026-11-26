import fs from 'node:fs';
import { AGENT_PROJECT_UNTRUSTED } from '@shared/types/agentManifest';
import { AppError } from '@shared/errors/appError';
import { appPathService } from '../../runtime/AppPathService';
import { agentManifestService } from '../agent-manifests/AgentManifestService';
import { AGENT_MANIFEST_FIELD_MOVED } from '../agent-manifests/agentManifestParse';
import { projectAgentTrust } from '../agent-manifests/ProjectAgentTrust';
import { resolveRegisteredProjectRoot, tryCurrentProjectRoot } from './resolveRegisteredProjectRoot';
import type {
  AgentBuiltinComparison,
  AgentDefinitionCommitQuery,
  AgentOverrideFilePreview,
  AgentOverrideFileRequest,
  ProjectAgentTrustPreview,
} from '@shared/types/agentManifest';

/** User-triggered actions on override files that do not apply as written. */
export class SettingsAgentOverrideOps {
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

  previewOverrideFile(sourcePath: string): AgentOverrideFilePreview {
    const target = this.resolveMovedFieldOverride({ sourcePath });
    return {
      sourcePath: target.sourcePath,
      sourceHash: target.sourceHash,
      agentId: target.agentId,
      scope: target.scope,
    };
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

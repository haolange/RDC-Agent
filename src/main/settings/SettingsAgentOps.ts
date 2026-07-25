import type { AppRuntimePaths } from '@shared/types/settings';
import type {
  AgentDefinitionCommitSnapshot,
  AgentDefinitionSaveRequest,
  AgentDefinitionSaveResult,
  AgentManifestDraft,
} from '@shared/types/agentManifest';
import { isSafeAgentProfileId } from '@shared/types/agent';
import { appPathService } from '../runtime/AppPathService';
import { agentManifestService } from './AgentManifestService';

export class SettingsAgentOps {
  private readonly agentDefinitionRevisions = new Map<string, number>();
  private readonly agentDefinitionCommits = new Map<string, AgentDefinitionCommitSnapshot>();
  private readonly agentDefinitionWriteTails = new Map<string, Promise<void>>();

  private async withAgentDefinitionWriteLock<T>(agentId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.agentDefinitionWriteTails.get(agentId) ?? Promise.resolve();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.catch(() => undefined).then(() => gate);
    this.agentDefinitionWriteTails.set(agentId, tail);
    await previous.catch(() => undefined);
    try {
      return await task();
    } finally {
      release();
      if (this.agentDefinitionWriteTails.get(agentId) === tail) {
        this.agentDefinitionWriteTails.delete(agentId);
      }
    }
  }

  private async readAgentDefinitionCommit(agentId: string): Promise<AgentDefinitionCommitSnapshot | null> {
    const cached = this.agentDefinitionCommits.get(agentId);
    const definition = await agentManifestService.readDefinition(appPathService.getRuntimePaths(), agentId);
    if (!definition) {
      return cached?.definition === null ? cached : null;
    }
    const commitHash = await agentManifestService.readCommitHash(definition.filePath);
    if (cached?.commitHash === commitHash) {
      const refreshed = {
        ...cached,
        definition,
        route: agentManifestService.routeFromDefinition(definition),
      };
      this.agentDefinitionCommits.set(agentId, refreshed);
      return refreshed;
    }
    const snapshot: AgentDefinitionCommitSnapshot = {
      clientRevision: 0,
      commitHash,
      definition,
      route: agentManifestService.routeFromDefinition(definition),
    };
    this.agentDefinitionCommits.set(agentId, snapshot);
    return snapshot;
  }

  private saveResult(
    request: AgentDefinitionSaveRequest,
    status: AgentDefinitionSaveResult['status'],
    snapshot: AgentDefinitionCommitSnapshot | null,
    error?: string,
  ): AgentDefinitionSaveResult {
    return {
      clientRevision: request.clientRevision,
      status,
      commitHash: snapshot?.commitHash ?? null,
      definition: snapshot?.definition ?? null,
      route: snapshot?.route ?? null,
      lastSuccessful: snapshot,
      ...(error ? { error } : {}),
    };
  }

  private async restoreAgentDefinitionCommit(
    paths: Pick<AppRuntimePaths, 'agentsPath' | 'instructionsPath'>,
    request: AgentDefinitionSaveRequest,
    snapshot: AgentDefinitionCommitSnapshot | null,
  ): Promise<void> {
    if (!snapshot?.definition) {
      await agentManifestService.saveDefinition(paths, { ...request.draft, delete: true });
      return;
    }
    const {
      filePath: _filePath,
      builtin: _builtin,
      updatedAt: _updatedAt,
      ...draft
    } = snapshot.definition;
    await agentManifestService.saveDefinition(paths, draft as AgentManifestDraft);
  }

  async getAgentDefinitionCommit(agentIdDraft: string): Promise<AgentDefinitionCommitSnapshot | null> {
    const agentId = agentIdDraft.trim();
    if (!isSafeAgentProfileId(agentId)) return null;
    return this.readAgentDefinitionCommit(agentId);
  }

  async saveAgentDefinition(request: AgentDefinitionSaveRequest): Promise<AgentDefinitionSaveResult> {
    const agentId = request.draft.id.trim();
    if (!isSafeAgentProfileId(agentId)) {
      return this.saveResult(request, 'failed', null, `Invalid agent profile id: ${agentId || '<empty>'}`);
    }
    if (!Number.isSafeInteger(request.clientRevision) || request.clientRevision < 1) {
      return this.saveResult(request, 'failed', await this.readAgentDefinitionCommit(agentId), 'clientRevision must be a positive safe integer.');
    }

    const latestRevision = this.agentDefinitionRevisions.get(agentId) ?? 0;
    if (request.clientRevision <= latestRevision) {
      return this.saveResult(request, 'superseded', await this.readAgentDefinitionCommit(agentId));
    }
    this.agentDefinitionRevisions.set(agentId, request.clientRevision);
    await Promise.resolve();

    return this.withAgentDefinitionWriteLock(agentId, async () => {
      const previous = await this.readAgentDefinitionCommit(agentId);
      if (this.agentDefinitionRevisions.get(agentId) !== request.clientRevision) {
        return this.saveResult(request, 'superseded', previous);
      }
      const paths = appPathService.getRuntimePaths();
      try {
        const commit = await agentManifestService.saveDefinition(paths, request.draft);
        if (this.agentDefinitionRevisions.get(agentId) !== request.clientRevision) {
          await this.restoreAgentDefinitionCommit(paths, request, previous);
          return this.saveResult(request, 'superseded', previous);
        }
        const snapshot: AgentDefinitionCommitSnapshot = {
          clientRevision: request.clientRevision,
          commitHash: commit.commitHash,
          definition: commit.definition,
          route: commit.definition ? agentManifestService.routeFromDefinition(commit.definition) : null,
        };
        this.agentDefinitionCommits.set(agentId, snapshot);
        return this.saveResult(request, 'committed', snapshot);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return this.agentDefinitionRevisions.get(agentId) === request.clientRevision
          ? this.saveResult(request, 'failed', previous, message)
          : this.saveResult(request, 'superseded', previous);
      }
    });
  }
}

import type { AppRuntimePaths } from '@shared/types/settings';
import type {
  AgentDefinitionCommitQuery,
  AgentDefinitionCommitSnapshot,
  AgentDefinitionSaveRequest,
  AgentDefinitionSaveResult,
  AgentManifestDraft,
} from '@shared/types/agentManifest';
import { agentDefinitionLaneKey } from '@shared/types/agentManifest';
import { isSafeAgentProfileId } from '@shared/types/agent';
import { appPathService } from '../runtime/AppPathService';
import { agentManifestService } from './AgentManifestService';
import { resolveRegisteredProjectRoot } from './resolveRegisteredProjectRoot';

export class SettingsAgentOps {
  private readonly agentDefinitionRevisions = new Map<string, number>();
  private readonly agentDefinitionCommits = new Map<string, AgentDefinitionCommitSnapshot>();
  private readonly agentDefinitionWriteTails = new Map<string, Promise<void>>();

  private laneKey(request: Pick<AgentDefinitionCommitQuery, 'scope' | 'projectId' | 'agentId'>): string {
    return agentDefinitionLaneKey(request.scope, request.projectId, request.agentId);
  }

  private async withAgentDefinitionWriteLock<T>(laneKey: string, task: () => Promise<T>): Promise<T> {
    const previous = this.agentDefinitionWriteTails.get(laneKey) ?? Promise.resolve();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.catch(() => undefined).then(() => gate);
    this.agentDefinitionWriteTails.set(laneKey, tail);
    await previous.catch(() => undefined);
    try {
      return await task();
    } finally {
      release();
      if (this.agentDefinitionWriteTails.get(laneKey) === tail) {
        this.agentDefinitionWriteTails.delete(laneKey);
      }
    }
  }

  private async readAgentDefinitionCommit(
    query: AgentDefinitionCommitQuery,
  ): Promise<AgentDefinitionCommitSnapshot | null> {
    const laneKey = this.laneKey(query);
    const cached = this.agentDefinitionCommits.get(laneKey);
    const projectRoot = query.scope === 'project' ? resolveRegisteredProjectRoot(query.projectId) : undefined;
    const definition = await agentManifestService.readDefinition(appPathService.getRuntimePaths(), query.agentId, {
      scope: query.scope,
      projectRoot,
    });
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
      this.agentDefinitionCommits.set(laneKey, refreshed);
      return refreshed;
    }
    const snapshot: AgentDefinitionCommitSnapshot = {
      clientRevision: 0,
      commitHash,
      definition,
      route: agentManifestService.routeFromDefinition(definition),
    };
    this.agentDefinitionCommits.set(laneKey, snapshot);
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
      await agentManifestService.saveDefinition(paths, { ...request.draft, delete: true }, {
        scope: request.scope,
        projectRoot: request.scope === 'project' ? resolveRegisteredProjectRoot(request.projectId) : undefined,
        sourceHash: request.sourceHash,
      });
      return;
    }
    const {
      filePath: _filePath,
      builtin: _builtin,
      updatedAt: _updatedAt,
      provenance: _provenance,
      compiledRoute: _compiledRoute,
      ...draft
    } = snapshot.definition;
    await agentManifestService.saveDefinition(paths, draft as AgentManifestDraft, {
      scope: request.scope,
      projectRoot: request.scope === 'project' ? resolveRegisteredProjectRoot(request.projectId) : undefined,
      sourceHash: request.sourceHash,
    });
  }

  async getAgentDefinitionCommit(query: AgentDefinitionCommitQuery): Promise<AgentDefinitionCommitSnapshot | null> {
    const agentId = query.agentId.trim();
    if (!isSafeAgentProfileId(agentId)) return null;
    return this.readAgentDefinitionCommit({
      agentId,
      scope: query.scope,
      projectId: query.projectId,
    });
  }

  async saveAgentDefinition(request: AgentDefinitionSaveRequest): Promise<AgentDefinitionSaveResult> {
    const agentId = request.draft.id.trim();
    if (!isSafeAgentProfileId(agentId)) {
      return this.saveResult(request, 'failed', null, `Invalid agent profile id: ${agentId || '<empty>'}`);
    }
    if (!Number.isSafeInteger(request.clientRevision) || request.clientRevision < 1) {
      return this.saveResult(request, 'failed', await this.readAgentDefinitionCommit({
        agentId,
        scope: request.scope,
        projectId: request.projectId,
      }), 'clientRevision must be a positive safe integer.');
    }

    const laneKey = this.laneKey({ agentId, scope: request.scope, projectId: request.projectId });
    const latestRevision = this.agentDefinitionRevisions.get(laneKey) ?? 0;
    if (request.clientRevision <= latestRevision) {
      return this.saveResult(request, 'superseded', await this.readAgentDefinitionCommit({
        agentId,
        scope: request.scope,
        projectId: request.projectId,
      }));
    }
    this.agentDefinitionRevisions.set(laneKey, request.clientRevision);
    await Promise.resolve();

    return this.withAgentDefinitionWriteLock(laneKey, async () => {
      const previous = await this.readAgentDefinitionCommit({
        agentId,
        scope: request.scope,
        projectId: request.projectId,
      });
      if (this.agentDefinitionRevisions.get(laneKey) !== request.clientRevision) {
        return this.saveResult(request, 'superseded', previous);
      }
      const paths = appPathService.getRuntimePaths();
      try {
        const commit = await agentManifestService.saveDefinition(paths, request.draft, {
          scope: request.scope,
          projectRoot: request.scope === 'project' ? resolveRegisteredProjectRoot(request.projectId) : undefined,
          sourceHash: request.sourceHash,
        });
        if (this.agentDefinitionRevisions.get(laneKey) !== request.clientRevision) {
          await this.restoreAgentDefinitionCommit(paths, request, previous);
          return this.saveResult(request, 'superseded', previous);
        }
        const snapshot: AgentDefinitionCommitSnapshot = {
          clientRevision: request.clientRevision,
          commitHash: commit.commitHash,
          definition: commit.definition,
          route: commit.definition?.compiledRoute
            ?? (commit.definition ? agentManifestService.routeFromDefinition(commit.definition) : null),
        };
        this.agentDefinitionCommits.set(laneKey, snapshot);
        return this.saveResult(request, 'committed', snapshot);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return this.agentDefinitionRevisions.get(laneKey) === request.clientRevision
          ? this.saveResult(request, 'failed', previous, message)
          : this.saveResult(request, 'superseded', previous);
      }
    });
  }
}

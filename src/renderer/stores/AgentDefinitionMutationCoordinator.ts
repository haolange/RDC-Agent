import type {
  AgentDefinitionCommitSnapshot,
  AgentDefinitionSaveRequest,
  AgentDefinitionSaveResult,
} from '@shared/types/agentManifest';

type CommitAgentDefinition = (request: AgentDefinitionSaveRequest) => Promise<AgentDefinitionSaveResult>;

interface PendingWaiter {
  request: AgentDefinitionSaveRequest;
  resolve: (result: AgentDefinitionSaveResult) => void;
  reject: (error: unknown) => void;
}

interface MutationLane {
  pending: AgentDefinitionSaveRequest | null;
  waiters: PendingWaiter[];
  timer: ReturnType<typeof setTimeout> | null;
  running: Promise<void> | null;
  lastSuccessful: AgentDefinitionCommitSnapshot | null;
  lastResult: AgentDefinitionSaveResult | null;
  lastError: unknown | null;
  latestRevision: number;
  runningRevision: number | null;
}

const supersededResult = (
  request: AgentDefinitionSaveRequest,
  snapshot: AgentDefinitionCommitSnapshot | null,
): AgentDefinitionSaveResult => ({
  clientRevision: request.clientRevision,
  status: 'superseded',
  commitHash: snapshot?.commitHash ?? null,
  definition: snapshot?.definition ?? null,
  route: snapshot?.route ?? null,
  lastSuccessful: snapshot,
});

export class AgentDefinitionMutationCoordinator {
  private readonly lanes = new Map<string, MutationLane>();

  constructor(
    private readonly commit: CommitAgentDefinition,
    private readonly debounceMs = 120,
  ) {}

  enqueue(request: AgentDefinitionSaveRequest): Promise<AgentDefinitionSaveResult> {
    const agentId = request.draft.id;
    const lane = this.getLane(agentId);
    if (request.clientRevision < lane.latestRevision) {
      return Promise.resolve(supersededResult(request, lane.lastSuccessful));
    }
    if (lane.runningRevision === request.clientRevision && !lane.pending) {
      return new Promise<AgentDefinitionSaveResult>((resolve, reject) => {
        lane.waiters.push({ request, resolve, reject });
      });
    }
    lane.latestRevision = request.clientRevision;
    lane.pending = request;
    if (lane.timer) clearTimeout(lane.timer);
    lane.timer = setTimeout(() => {
      lane.timer = null;
      void this.runLane(agentId);
    }, this.debounceMs);
    return new Promise<AgentDefinitionSaveResult>((resolve, reject) => {
      lane.waiters.push({ request, resolve, reject });
    });
  }

  async flush(agentId: string): Promise<AgentDefinitionCommitSnapshot | null> {
    const lane = this.lanes.get(agentId);
    if (!lane) return null;
    if (lane.timer) {
      clearTimeout(lane.timer);
      lane.timer = null;
    }
    while (lane.pending || lane.running) {
      await this.runLane(agentId);
    }
    if (lane.lastResult?.status === 'failed') {
      throw new Error(lane.lastResult.error ?? 'Agent definition save failed.');
    }
    if (lane.lastError) throw lane.lastError;
    return lane.lastSuccessful;
  }

  private getLane(agentId: string): MutationLane {
    const current = this.lanes.get(agentId);
    if (current) return current;
    const lane: MutationLane = {
      pending: null,
      waiters: [],
      timer: null,
      running: null,
      lastSuccessful: null,
      lastResult: null,
      lastError: null,
      latestRevision: 0,
      runningRevision: null,
    };
    this.lanes.set(agentId, lane);
    return lane;
  }

  private async runLane(agentId: string): Promise<void> {
    const lane = this.getLane(agentId);
    if (lane.running) {
      await lane.running;
      return;
    }
    const request = lane.pending;
    if (!request) return;
    if (lane.timer) {
      clearTimeout(lane.timer);
      lane.timer = null;
    }
    lane.pending = null;
    lane.runningRevision = request.clientRevision;
    lane.running = this.commit(request)
      .then((result) => {
        lane.lastError = null;
        lane.lastResult = result;
        if (result.lastSuccessful) lane.lastSuccessful = result.lastSuccessful;
        if (lane.pending) return;
        const waiters = lane.waiters.splice(0);
        for (const waiter of waiters) {
          waiter.resolve(waiter.request.clientRevision === request.clientRevision
            ? result
            : supersededResult(waiter.request, result.lastSuccessful));
        }
      })
      .catch((error) => {
        if (lane.pending) return;
        lane.lastError = error;
        const waiters = lane.waiters.splice(0);
        for (const waiter of waiters) waiter.reject(error);
      })
      .finally(() => {
        lane.running = null;
        lane.runningRevision = null;
      });
    await lane.running;
    if (lane.pending) await this.runLane(agentId);
  }
}

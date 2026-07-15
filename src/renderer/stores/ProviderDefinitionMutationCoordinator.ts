import type {
  ProviderDefinitionCommitSnapshot,
  ProviderDefinitionSaveRequest,
  ProviderDefinitionSaveResult,
} from '@shared/types/settings';

type CommitProviderDefinition = (
  request: ProviderDefinitionSaveRequest,
) => Promise<ProviderDefinitionSaveResult>;

interface Waiter {
  request: ProviderDefinitionSaveRequest;
  resolve: (result: ProviderDefinitionSaveResult) => void;
  reject: (error: unknown) => void;
}

interface Lane {
  pending: ProviderDefinitionSaveRequest | null;
  waiters: Waiter[];
  timer: ReturnType<typeof setTimeout> | null;
  running: Promise<void> | null;
  latestRevision: number;
  lastSuccessful: ProviderDefinitionCommitSnapshot | null;
  lastResult: ProviderDefinitionSaveResult | null;
  lastError: unknown | null;
}

const superseded = (
  request: ProviderDefinitionSaveRequest,
  snapshot: ProviderDefinitionCommitSnapshot | null,
): ProviderDefinitionSaveResult => ({
  clientRevision: request.clientRevision,
  providerId: request.provider.id,
  status: 'superseded',
  commitHash: snapshot?.commitHash ?? null,
  provider: snapshot?.provider ?? null,
  catalogRevision: snapshot?.catalogRevision ?? null,
  lastSuccessful: snapshot,
});

export class ProviderDefinitionMutationCoordinator {
  private readonly lanes = new Map<string, Lane>();

  constructor(
    private readonly commit: CommitProviderDefinition,
    private readonly debounceMs = 120,
  ) {}

  enqueue(request: ProviderDefinitionSaveRequest): Promise<ProviderDefinitionSaveResult> {
    const lane = this.getLane(request.provider.id);
    if (request.clientRevision < lane.latestRevision) {
      return Promise.resolve(superseded(request, lane.lastSuccessful));
    }
    lane.latestRevision = request.clientRevision;
    lane.pending = request;
    if (lane.timer) clearTimeout(lane.timer);
    lane.timer = setTimeout(() => {
      lane.timer = null;
      void this.runLane(request.provider.id);
    }, this.debounceMs);
    return new Promise((resolve, reject) => lane.waiters.push({ request, resolve, reject }));
  }

  async flush(providerId: string): Promise<ProviderDefinitionCommitSnapshot | null> {
    const lane = this.lanes.get(providerId);
    if (!lane) return null;
    if (lane.timer) {
      clearTimeout(lane.timer);
      lane.timer = null;
    }
    while (lane.pending || lane.running) await this.runLane(providerId);
    if (lane.lastResult?.status === 'failed') {
      throw new Error(lane.lastResult.error ?? 'Provider settings save failed.');
    }
    if (lane.lastError) throw lane.lastError;
    return lane.lastSuccessful;
  }

  private getLane(providerId: string): Lane {
    const existing = this.lanes.get(providerId);
    if (existing) return existing;
    const lane: Lane = {
      pending: null,
      waiters: [],
      timer: null,
      running: null,
      latestRevision: 0,
      lastSuccessful: null,
      lastResult: null,
      lastError: null,
    };
    this.lanes.set(providerId, lane);
    return lane;
  }

  private async runLane(providerId: string): Promise<void> {
    const lane = this.getLane(providerId);
    if (lane.running) return lane.running;
    const request = lane.pending;
    if (!request) return;
    lane.pending = null;
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
            : superseded(waiter.request, result.lastSuccessful));
        }
      })
      .catch((error) => {
        if (lane.pending) return;
        lane.lastError = error;
        for (const waiter of lane.waiters.splice(0)) waiter.reject(error);
      })
      .finally(() => { lane.running = null; });
    await lane.running;
    if (lane.pending) await this.runLane(providerId);
  }
}

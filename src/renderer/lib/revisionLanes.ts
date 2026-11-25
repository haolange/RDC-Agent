/**
 * The renderer's one primitive for intents and reads that can overlap. A lane is one thing a person or a read can
 * change: a provider's model choices, an Agent file, a session field, the sidebar selection, a catalog scope. Every
 * intent on a lane takes the lane's next client revision, main orders each lane by that revision (an older one is
 * answered as superseded, never written over a newer one), and a result changes renderer state only through
 * `isLatest` / `applyIfNewer`, so a late answer to an earlier intent never undoes a later one.
 */

let lastRevision = 0;

/**
 * The next client revision. Revisions only grow, across lanes and across renderer reloads (they start from the
 * clock), because main outlives the renderer and keeps the newest revision it saw on each lane.
 */
export function nextClientRevision(): number {
  lastRevision = Math.max(Date.now() * 1_000, lastRevision + 1);
  return lastRevision;
}

export class RevisionLanes {
  private readonly begun = new Map<string, number>();
  private readonly applied = new Map<string, number>();
  /** Writes in flight per lane, in revision order. */
  private readonly writes = new Map<string, Map<number, Promise<unknown>>>();

  /** Starts an intent on `lane`; its revision supersedes every earlier one of the lane. */
  begin(lane: string): number {
    const revision = nextClientRevision();
    this.begun.set(lane, revision);
    return revision;
  }

  /** Whether `revision` is still the newest intent begun on `lane`. */
  isLatest(lane: string, revision: number): boolean {
    return this.begun.get(lane) === revision;
  }

  /** Runs `apply` only when `revision` is newer than the last result applied on `lane`; returns whether it ran. */
  applyIfNewer(lane: string, revision: number, apply?: () => void): boolean {
    if (revision <= (this.applied.get(lane) ?? 0)) return false;
    this.applied.set(lane, revision);
    apply?.();
    return true;
  }

  /** Keeps `write`, the request intent `revision` sent, in flight on `lane` until it settles. */
  track<T>(lane: string, revision: number, write: Promise<T>): Promise<T> {
    const writes = this.writes.get(lane) ?? new Map<number, Promise<unknown>>();
    this.writes.set(lane, writes);
    writes.set(revision, write);
    const release = () => {
      writes.delete(revision);
      if (writes.size === 0 && this.writes.get(lane) === writes) this.writes.delete(lane);
    };
    write.then(release, release);
    return write;
  }

  /** The newest write still in flight on `lane`. */
  inFlight(lane: string): Promise<unknown> | undefined {
    const writes = this.writes.get(lane);
    return writes ? [...writes.values()].at(-1) : undefined;
  }

  busy(lane: string): boolean {
    return this.writes.has(lane);
  }

  /**
   * Resolves once every write in flight on `lane` has settled, including writes begun while waiting; rejects with the
   * failure of the newest of them when it failed. With nothing in flight it resolves at once.
   */
  async settled(lane: string): Promise<void> {
    let newest: Promise<unknown> | undefined;
    for (let writes = this.writes.get(lane); writes; writes = this.writes.get(lane)) {
      newest = [...writes.values()].at(-1);
      await Promise.allSettled(writes.values());
    }
    if (newest) await newest;
  }

  /** Drops what the lane remembers: a later result of an intent begun before is no longer the latest. */
  forget(lane: string): void {
    this.begun.delete(lane);
    this.applied.delete(lane);
    this.writes.delete(lane);
  }

  reset(): void {
    this.begun.clear();
    this.applied.clear();
    this.writes.clear();
  }
}

/** At most one request in flight and one newest pending value. */
export function createReplayApplyQueue<T>(apply: (value: T) => Promise<unknown>, onError: (error: unknown) => void, interval = 100) {
  let pending: T | undefined;
  let running = false;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const drain = async () => {
    timer = undefined;
    if (running || disposed || pending === undefined) return;
    const value = pending;
    pending = undefined;
    running = true;
    try { await apply(value); } catch (error) { reportFailure(error); }
    finally { settle(); }
  };
  // These run once apply() settles: dispose() and enqueue() may have run while it was awaited.
  const reportFailure = (error: unknown) => { if (!disposed) onError(error); };
  const settle = () => {
    running = false;
    if (!disposed && pending !== undefined) void drain();
  };
  return {
    enqueue(value: T, flush = false) {
      if (disposed) return;
      pending = value;
      if (flush && timer) { clearTimeout(timer); timer = undefined; }
      if (!running && !timer) {
        if (flush) void drain();
        else timer = setTimeout(() => void drain(), interval);
      }
    },
    flush() {
      if (timer) { clearTimeout(timer); timer = undefined; }
      if (!running) void drain();
    },
    dispose() { disposed = true; pending = undefined; if (timer) clearTimeout(timer); },
  };
}

/**
 * EventStream — Pi Agent 风格的通用异步事件流。
 *
 * 设计目标：
 * - 同时支持 `for await (const event of stream)` 流式消费
 *   与 `await stream.result()` 一次性获取最终结果。
 * - 生产者通过 `push` / `complete` / `error` / `abort` 控制流。
 * - 链式 `map` / `filter` / `tap` 只针对事件序列做转换，
 *   最终结果（result）始终来自原始流，避免在转换链中丢失。
 *
 * 类型参数：
 * - `T`：事件类型。
 * - `R`：最终结果类型（默认与 `T` 相同）。
 *
 * 用法示例：
 * ```ts
 * const stream = new EventStream<AssistantMessageEvent, AssistantMessage>(
 *   (e) => e.type === 'done',
 *   (e) => (e as { message: AssistantMessage }).message,
 * );
 * for await (const ev of stream) { ... }
 * const final = await stream.result();
 * ```
 */
export class EventStream<T, R = T> implements AsyncIterable<T> {
  private queue: T[] = [];
  private waiting: Array<{
    resolve: (value: IteratorResult<T>) => void;
    reject: (err: Error) => void;
  }> = [];
  private done = false;
  private _error: Error | undefined;
  private resultResolve!: (value: R) => void;
  private resultReject!: (error: Error) => void;
  private readonly resultPromise: Promise<R>;
  private resultSettled = false;
  private readonly abortController = new AbortController();

  /**
   * @param isComplete 可选：判断某个事件是否意味着流应当结束。
   *                   返回 true 时会自动调用 `complete(extractResult(event))`。
   * @param extractResult 当 `isComplete` 命中时，从事件中抽取最终结果的函数。
   *                      若未提供，则将事件本身作为结果（要求 `R` 兼容 `T`）。
   */
  constructor(
    private readonly isComplete?: (event: T) => boolean,
    private readonly extractResult?: (event: T) => R,
  ) {
    this.resultPromise = new Promise<R>((resolve, reject) => {
      this.resultResolve = resolve;
      this.resultReject = reject;
    });
    // 防止 Node 报告 unhandledRejection：消费者通过 result()/迭代器自行处理错误。
    this.resultPromise.catch(() => {
      /* swallow: result() 调用方负责处理 */
    });
  }

  // -------------------------------------------------------------------
  // 生产者 API
  // -------------------------------------------------------------------

  /** 向流中推送一个事件；若有等待中的消费者会直接交付。 */
  push(event: T): void {
    if (this.done) {
      // 流已结束的事件被静默丢弃，避免污染下游状态。
      return;
    }

    if (this.waiting.length > 0) {
      const resolver = this.waiting.shift()!;
      resolver.resolve({ value: event, done: false });
    } else {
      this.queue.push(event);
    }

    if (this.isComplete && this.isComplete(event)) {
      const result = this.extractResult
        ? this.extractResult(event)
        : (event as unknown as R);
      this.complete(result);
    }
  }

  /** 标记流正常结束，并提供最终结果。 */
  complete(result: R): void {
    if (this.done) {
      return;
    }
    this.done = true;
    if (!this.resultSettled) {
      this.resultSettled = true;
      this.resultResolve(result);
    }
    this.flushWaitingDone();
  }

  /** 标记流以错误结束。 */
  error(err: Error): void {
    if (this.done) {
      return;
    }
    this.done = true;
    this._error = err;
    if (!this.resultSettled) {
      this.resultSettled = true;
      this.resultReject(err);
    }
    // 通过 reject 让所有等待中的消费者抛错。
    const waiters = this.waiting.splice(0);
    for (const w of waiters) {
      w.reject(err);
    }
  }

  /** 中止流：发出 abort 信号并以 AbortError 终止。 */
  abort(): void {
    if (this.done) {
      return;
    }
    if (!this.abortController.signal.aborted) {
      this.abortController.abort();
    }
    const abortErr = new Error('EventStream aborted');
    abortErr.name = 'AbortError';
    this.error(abortErr);
  }

  // -------------------------------------------------------------------
  // 消费者 API
  // -------------------------------------------------------------------

  /** AsyncIterable 协议入口，支持 `for await ... of stream`。 */
  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this._error && this.queue.length === 0) {
          return Promise.reject(this._error);
        }
        if (this.queue.length > 0) {
          const value = this.queue.shift()!;
          return Promise.resolve({ value, done: false });
        }
        if (this.done) {
          return Promise.resolve({
            value: undefined as unknown as T,
            done: true,
          });
        }
        return new Promise<IteratorResult<T>>((resolve, reject) => {
          this.waiting.push({ resolve, reject });
        });
      },
      return: (): Promise<IteratorResult<T>> => {
        // 提前退出迭代时，主动中止流。
        if (!this.done) {
          this.abort();
        }
        return Promise.resolve({
          value: undefined as unknown as T,
          done: true,
        });
      },
      throw: (err?: unknown): Promise<IteratorResult<T>> => {
        if (!this.done) {
          this.error(err instanceof Error ? err : new Error(String(err)));
        }
        return Promise.reject(err);
      },
    };
  }

  /** 等待并获取最终结果。 */
  result(): Promise<R> {
    return this.resultPromise;
  }

  // -------------------------------------------------------------------
  // 链式操作
  // -------------------------------------------------------------------

  /**
   * 对每个事件应用 `fn`，返回新的事件流。
   * 最终结果保持原流的 `R`。
   */
  map<U>(fn: (event: T) => U): EventStream<U, R> {
    const downstream = new EventStream<U, R>();
    void this.pipeTo(
      downstream,
      (event) => downstream.push(fn(event)),
    );
    return downstream;
  }

  /** 过滤事件，返回新的事件流。 */
  filter(fn: (event: T) => boolean): EventStream<T, R> {
    const downstream = new EventStream<T, R>();
    void this.pipeTo(downstream, (event) => {
      if (fn(event)) {
        downstream.push(event);
      }
    });
    return downstream;
  }

  /** 旁路观察事件，不改变流内容。 */
  tap(fn: (event: T) => void): EventStream<T, R> {
    const downstream = new EventStream<T, R>();
    void this.pipeTo(downstream, (event) => {
      try {
        fn(event);
      } catch {
        /* tap 中的异常不应中断流 */
      }
      downstream.push(event);
    });
    return downstream;
  }

  // -------------------------------------------------------------------
  // 状态查询
  // -------------------------------------------------------------------

  /** 流是否已结束（无论成功或失败）。 */
  get isDone(): boolean {
    return this.done;
  }

  /** 中止信号，便于下游传递给 fetch 等异步 API。 */
  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  // -------------------------------------------------------------------
  // 内部辅助
  // -------------------------------------------------------------------

  /** 流结束时清空等待中的消费者，让它们收到 done=true。 */
  private flushWaitingDone(): void {
    const waiters = this.waiting.splice(0);
    for (const w of waiters) {
      w.resolve({ value: undefined as unknown as T, done: true });
    }
  }

  /**
   * 把当前流的事件 / 终止状态转发到 downstream。
   * `onEvent` 决定如何把事件投递到 downstream（map/filter/tap 可定制）。
   */
  private async pipeTo<U, DR>(
    downstream: EventStream<U, DR>,
    onEvent: (event: T) => void,
  ): Promise<void> {
    try {
      for await (const event of this) {
        if (downstream.isDone) {
          return;
        }
        onEvent(event);
      }
      // 上游正常结束：把上游的最终结果作为 downstream 的结果。
      try {
        const finalResult = await this.resultPromise;
        downstream.complete(finalResult as unknown as DR);
      } catch (err) {
        downstream.error(err instanceof Error ? err : new Error(String(err)));
      }
    } catch (err) {
      downstream.error(err instanceof Error ? err : new Error(String(err)));
    }
  }
}

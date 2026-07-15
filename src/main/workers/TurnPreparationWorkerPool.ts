import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import {
  computeTurnPreparation,
  type TurnPreparationComputationInput,
  type TurnPreparationComputationResult,
} from './TurnPreparationComputation';

interface PendingTask {
  id: number;
  input: TurnPreparationComputationInput;
  signal?: AbortSignal;
  resolve: (result: TurnPreparationComputationResult) => void;
  reject: (error: Error) => void;
  abort: () => void;
}

interface WorkerSlot {
  worker: Worker;
  task: PendingTask | null;
}

export class TurnPreparationWorkerPool {
  private readonly queue: PendingTask[] = [];
  private readonly slots: WorkerSlot[] = [];
  private nextTaskId = 1;

  constructor(private readonly maxWorkers = 2) {}

  async run(
    input: TurnPreparationComputationInput,
    signal?: AbortSignal,
  ): Promise<TurnPreparationComputationResult> {
    if (signal?.aborted) throw new Error('REQUEST_CANCELLED: request preparation was cancelled.');
    const workerPath = path.join(__dirname, 'turnPreparationWorker.js');
    if (process.env.VITEST || !fs.existsSync(workerPath)) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (signal?.aborted) throw new Error('REQUEST_CANCELLED: request preparation was cancelled.');
      return computeTurnPreparation(input);
    }
    return new Promise<TurnPreparationComputationResult>((resolve, reject) => {
      const task: PendingTask = {
        id: this.nextTaskId++, input, signal, resolve, reject,
        abort: () => this.abortTask(task),
      };
      signal?.addEventListener('abort', task.abort, { once: true });
      this.queue.push(task);
      this.dispatch(workerPath);
    });
  }

  private dispatch(workerPath: string): void {
    while (this.queue.length > 0) {
      let slot = this.slots.find((entry) => entry.task === null);
      if (!slot && this.slots.length < this.maxWorkers) slot = this.createSlot(workerPath);
      if (!slot) return;
      const task = this.queue.shift()!;
      if (task.signal?.aborted) {
        task.signal.removeEventListener('abort', task.abort);
        task.reject(new Error('REQUEST_CANCELLED: request preparation was cancelled.'));
        continue;
      }
      slot.task = task;
      slot.worker.postMessage({ id: task.id, input: task.input });
    }
  }

  private createSlot(workerPath: string): WorkerSlot {
    const worker = new Worker(workerPath);
    worker.unref();
    const slot: WorkerSlot = { worker, task: null };
    worker.on('message', (message: { id: number; result?: TurnPreparationComputationResult; error?: string }) => {
      const task = slot.task;
      if (!task || task.id !== message.id) return;
      slot.task = null;
      task.signal?.removeEventListener('abort', task.abort);
      if (message.error) task.reject(new Error(message.error));
      else if (message.result) task.resolve(message.result);
      else task.reject(new Error('Turn preparation worker returned an empty result.'));
      this.dispatch(workerPath);
    });
    worker.on('error', (error) => this.failSlot(slot, error, workerPath));
    worker.on('exit', (code) => {
      if (code !== 0 && this.slots.includes(slot)) {
        this.failSlot(slot, new Error(`Turn preparation worker exited with code ${code}.`), workerPath);
      }
    });
    this.slots.push(slot);
    return slot;
  }

  private abortTask(task: PendingTask): void {
    const queueIndex = this.queue.indexOf(task);
    if (queueIndex >= 0) {
      this.queue.splice(queueIndex, 1);
      task.reject(new Error('REQUEST_CANCELLED: request preparation was cancelled.'));
      return;
    }
    const slot = this.slots.find((entry) => entry.task === task);
    if (!slot) return;
    slot.task = null;
    this.slots.splice(this.slots.indexOf(slot), 1);
    void slot.worker.terminate();
    task.reject(new Error('REQUEST_CANCELLED: request preparation was cancelled.'));
    this.dispatch(path.join(__dirname, 'turnPreparationWorker.js'));
  }

  private failSlot(slot: WorkerSlot, error: Error, workerPath: string): void {
    const index = this.slots.indexOf(slot);
    if (index >= 0) this.slots.splice(index, 1);
    const task = slot.task;
    slot.task = null;
    if (task) {
      task.signal?.removeEventListener('abort', task.abort);
      task.reject(error);
    }
    this.dispatch(workerPath);
  }
}

export const turnPreparationWorkerPool = new TurnPreparationWorkerPool();

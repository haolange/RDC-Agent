import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TurnPreparationWorkerPool } from './TurnPreparationWorkerPool';
import type { LifecycleEvent } from '../../runtime/LifecycleLedger';

const recorded = vi.hoisted(() => [] as LifecycleEvent[]);
vi.mock('../../runtime/LifecycleLedger', () => ({
  lifecycleLedger: { record: (event: LifecycleEvent) => recorded.push(event) > 0 },
}));

const input = { messages: [], modelId: 'model', messageBudget: 1_000, imageTokenAdjustment: 0 };

describe('turn preparation worker pool faults', () => {
  let root = '';
  const workerFile = (source: string) => {
    const file = path.join(root, 'worker.cjs');
    fs.writeFileSync(file, `const { parentPort } = require('node:worker_threads');\n${source}\n`);
    return file;
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-turn-preparation-worker-'));
    recorded.length = 0;
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('records a worker that dies under a task and fails the task', async () => {
    const pool = new TurnPreparationWorkerPool(1, workerFile("parentPort.on('message', () => process.exit(7));"));
    await expect(pool.run(input)).rejects.toThrow('exited with code 7');
    expect(recorded).toEqual([
      { kind: 'worker_thread_exited', worker: 'turn-preparation', reason: 'exit', exitCode: 7 },
    ]);
  });

  it('records an idle worker that dies after its task settled', async () => {
    const pool = new TurnPreparationWorkerPool(
      1,
      workerFile(
        `parentPort.on('message', ({ id }) => {
          parentPort.postMessage({ id, result: { compactedMessages: [], compactionApplied: false } });
          setTimeout(() => process.exit(9), 20);
        });`,
      ),
    );
    await expect(pool.run(input)).resolves.toMatchObject({ compactionApplied: false });
    await vi.waitFor(() => expect(recorded).toHaveLength(1));
    expect(recorded[0]).toMatchObject({ worker: 'turn-preparation', reason: 'exit', exitCode: 9 });
  });
});

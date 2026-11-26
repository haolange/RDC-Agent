import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { lifecycleLedger } from '../../../runtime/LifecycleLedger';
import { GREP_REGEX_TIMEOUT_MS } from '../../../runtime/toolLimits';
import type { GrepWorkerMatch, GrepWorkerRequest, GrepWorkerResponse } from '../../../workers/grepRegexWorker';

const WORKER_STARTUP_TIMEOUT_MS = 5_000;

/** Run whole-line regex matching away from the main event loop so a timeout can stop it. */
export function searchLongLines(
  lines: string[],
  regex: RegExp,
  limit: number,
  signal?: AbortSignal,
): Promise<GrepWorkerMatch[]> {
  if (signal?.aborted) return Promise.reject(new Error('Aborted'));
  // The bundle ships the compiled worker beside this module; from source, Node strips the worker's types.
  const bundledWorker = path.join(__dirname, 'grepRegexWorker.js');
  const runsFromBundle = fs.existsSync(bundledWorker);
  const workerPath = runsFromBundle ? bundledWorker : path.resolve(__dirname, '../../../workers/grepRegexWorker.ts');
  const request: GrepWorkerRequest = { lines, source: regex.source, flags: regex.flags, limit };
  return new Promise<GrepWorkerMatch[]>((resolve, reject) => {
    const worker = new Worker(workerPath, { execArgv: runsFromBundle ? [] : ['--experimental-strip-types'] });
    let settled = false;
    let executionTimer: NodeJS.Timeout | undefined;
    const startupTimer = setTimeout(
      () => finish(new Error('grep worker startup timed out')),
      WORKER_STARTUP_TIMEOUT_MS,
    );
    const abort = () => finish(new Error('Aborted'));
    const finish = (error?: Error, matches?: GrepWorkerMatch[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(startupTimer);
      if (executionTimer) clearTimeout(executionTimer);
      signal?.removeEventListener('abort', abort);
      void worker.terminate().then(() => {
        if (error) reject(error);
        else resolve(matches ?? []);
      }, reject);
    };
    signal?.addEventListener('abort', abort, { once: true });
    worker.on('message', (message: GrepWorkerResponse) => {
      if (settled) return;
      if (message.type === 'ready') {
        clearTimeout(startupTimer);
        executionTimer = setTimeout(
          () => finish(new Error(`grep pattern timed out after ${GREP_REGEX_TIMEOUT_MS}ms`)),
          GREP_REGEX_TIMEOUT_MS,
        );
        worker.postMessage(request);
      } else finish(undefined, message.matches);
    });
    worker.once('error', (error) => {
      lifecycleLedger.record({
        kind: 'worker_thread_exited',
        worker: 'grep-regex',
        reason: 'error',
        message: error.message.slice(0, 500),
      });
      finish(error);
    });
    // A worker this search terminated has settled already; only an exit nobody asked for is a fault.
    worker.once('exit', (code) => {
      if (settled) return;
      lifecycleLedger.record({ kind: 'worker_thread_exited', worker: 'grep-regex', reason: 'exit', exitCode: code });
      finish(new Error(`grep worker exited with code ${code}`));
    });
  });
}

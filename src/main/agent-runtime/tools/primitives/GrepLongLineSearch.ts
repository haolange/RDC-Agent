import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { GREP_REGEX_TIMEOUT_MS } from './toolLimits';
import type { GrepWorkerMatch, GrepWorkerRequest, GrepWorkerResponse } from '../../../workers/grepRegexWorker';

const WORKER_STARTUP_TIMEOUT_MS = 5_000;

/** Run whole-line regex matching away from the main event loop so a timeout can stop it. */
export function searchLongLines(
  lines: string[], regex: RegExp, limit: number, signal?: AbortSignal,
): Promise<GrepWorkerMatch[]> {
  if (signal?.aborted) return Promise.reject(new Error('Aborted'));
  const workerPath = process.env.VITEST
    ? path.resolve(__dirname, '../../../workers/grepRegexWorker.ts')
    : path.join(__dirname, 'grepRegexWorker.js');
  const request: GrepWorkerRequest = { lines, source: regex.source, flags: regex.flags, limit };
  return new Promise<GrepWorkerMatch[]>((resolve, reject) => {
    const worker = new Worker(workerPath, { execArgv: process.env.VITEST ? ['--experimental-strip-types'] : [] });
    let settled = false;
    let executionTimer: NodeJS.Timeout | undefined;
    const startupTimer = setTimeout(() => finish(new Error('grep worker startup timed out')), WORKER_STARTUP_TIMEOUT_MS);
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
        executionTimer = setTimeout(() => finish(new Error(`grep pattern timed out after ${GREP_REGEX_TIMEOUT_MS}ms`)), GREP_REGEX_TIMEOUT_MS);
        worker.postMessage(request);
      } else if (message.type === 'result') finish(undefined, message.matches);
      else finish(new Error('Invalid grep worker response'));
    });
    worker.once('error', (error) => finish(error));
    worker.once('exit', (code) => { if (!settled) finish(new Error(`grep worker exited with code ${code}`)); });
  });
}

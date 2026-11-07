import { parentPort } from 'node:worker_threads';

export interface GrepWorkerRequest {
  source: string;
  flags: string;
  lines: string[];
  limit: number;
}

export interface GrepWorkerMatch {
  lineIndex: number;
  matchIndex: number;
  matchLength: number;
}

export type GrepWorkerResponse = { type: 'ready' } | { type: 'result'; matches: GrepWorkerMatch[] };

if (!parentPort) throw new Error('Grep worker requires a parent port.');
parentPort.postMessage({ type: 'ready' } satisfies GrepWorkerResponse);
parentPort.once('message', (request: GrepWorkerRequest) => {
  const regex = new RegExp(request.source, request.flags);
  const matches: GrepWorkerMatch[] = [];
  for (let lineIndex = 0; lineIndex < request.lines.length && matches.length < request.limit; lineIndex += 1) {
    regex.lastIndex = 0;
    const match = regex.exec(request.lines[lineIndex]);
    if (match) matches.push({ lineIndex, matchIndex: match.index, matchLength: match[0].length });
  }
  parentPort!.postMessage({ type: 'result', matches } satisfies GrepWorkerResponse);
});

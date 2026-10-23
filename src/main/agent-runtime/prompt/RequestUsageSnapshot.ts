import fs from 'node:fs';
import path from 'node:path';

export interface RequestUsageSnapshot {
  observedAt: number;
  isReservation: false;
  source: 'committed-request-snapshots';
  scopeId: string;
  committedRequests: number;
  scopes: Array<{ scopeKey: string; turns: Array<{ turnId: string; committedRequests: number }> }>;
}

/** Count the existing request commits, including failures and auxiliary turns.
 * Never parse or retain request messages, credentials, or provider reasoning.
 * This is local attempt accounting, not provider billing or remaining quota.
 */
export function readRequestUsage(rootPath: string, scopeId: string): RequestUsageSnapshot {
  const scopeKey = scopeId.replace(/[^a-zA-Z0-9._-]/g, '-');
  const childPrefix = `${scopeId}::subagent::`.replace(/[^a-zA-Z0-9._-]/g, '-');
  const scopes: RequestUsageSnapshot['scopes'] = [];
  const entries = fs.existsSync(rootPath) ? fs.readdirSync(rootPath, { withFileTypes: true }) : [];
  for (const scope of entries) {
    if (scope.name !== scopeKey && !scope.name.startsWith(childPrefix)) continue;
    if (!scope.isDirectory()) throw new Error('REQUEST_USAGE_SCOPE_NOT_DIRECTORY');
    const turns: RequestUsageSnapshot['scopes'][number]['turns'] = [];
    for (const turn of fs.readdirSync(path.join(rootPath, scope.name), { withFileTypes: true })) {
      if (!turn.isDirectory()) {
        if (turn.isSymbolicLink()) throw new Error('REQUEST_USAGE_TURN_LINK_DENIED');
        continue;
      }
      const requests = fs.readdirSync(path.join(rootPath, scope.name, turn.name), { withFileTypes: true })
        .filter(entry => /^\d+-.+\.json$/.test(entry.name));
      if (requests.some(entry => !entry.isFile())) throw new Error('REQUEST_USAGE_COMMIT_NOT_FILE');
      turns.push({ turnId: turn.name, committedRequests: requests.length });
    }
    scopes.push({ scopeKey: scope.name, turns: turns.sort((a, b) => a.turnId.localeCompare(b.turnId)) });
  }
  return { observedAt: Date.now(), isReservation: false, source: 'committed-request-snapshots', scopeId,
    committedRequests: scopes.reduce((sum, scope) => sum + scope.turns.reduce((n, turn) => n + turn.committedRequests, 0), 0),
    scopes: scopes.sort((a, b) => a.scopeKey.localeCompare(b.scopeKey)) };
}

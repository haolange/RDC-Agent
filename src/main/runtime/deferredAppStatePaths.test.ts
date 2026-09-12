import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appPathService } from './AppPathService';
import { HookEngine } from '../hooks/HookEngine';
import { McpTrustService } from '../settings/McpTrustService';
import { RequestSnapshotStore } from '../agent-runtime/prompt/RequestSnapshotStore';
import { TraceService } from '../agent-trace/TraceService';

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true }));
});

describe('app state paths after startup', () => {
  it('resolves paths at first use, never during construction', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-state-paths-'));
    roots.push(root);
    const getPaths = vi.spyOn(appPathService, 'getAppStatePaths');
    const hooks = new HookEngine();
    const mcp = new McpTrustService();
    const snapshots = new RequestSnapshotStore();
    const trace = new TraceService();
    expect(getPaths).not.toHaveBeenCalled();
    getPaths.mockReturnValue({ ...appPathService.getAppStatePaths(), appStateRoot: root,
      llmCallsPath: path.join(root, 'llm-calls'), tracesPath: path.join(root, 'traces') });
    const userHooks = path.join(root, 'hooks');
    fs.mkdirSync(userHooks);
    fs.writeFileSync(path.join(userHooks, 'audit.hook.yml'), 'id: audit\nevent: session.before-start\ncommand: echo\nargs: [audit]\nfailurePolicy: warn\n');
    hooks.load(userHooks, undefined, path.join(root, 'builtin'));
    hooks.trustUserHook('audit');
    expect(fs.existsSync(path.join(root, 'hook-trust.json'))).toBe(true);
    expect(mcp.isTrusted(root, 'audit', 'hash')).toBe(false);
    expect(snapshots.list('session')).toEqual([]);
    expect(trace.getRun('missing')).toBeNull();
    expect(fs.existsSync(path.join(root, 'traces', 'runs'))).toBe(true);
  });
});

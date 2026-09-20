import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../runtime/RuntimeLogService', () => ({ runtimeLogService: { log: vi.fn() } }));
vi.mock('../settings/SettingsService', () => ({
  settingsService: { getAll: () => ({ tooling: { rdcCli: { enabled: true, command: 'rdc', argsPrefix: [], workingDirectory: '', env: {}, timeoutMs: 1_000 } } }) },
}));
vi.mock('../tools/RdcCliInvokerService', () => ({ rdcCliInvokerService: { executeCLI: vi.fn() } }));
vi.mock('../runtime/AppPathService', () => ({
  appPathService: { getAppStatePaths: () => ({ appStateRoot: 'unused' }), getUserRdcPaths: () => ({ rdcIntermediateRoot: 'unused' }) },
}));
import {
  harvestOwnedRdcDaemons,
  isAppRdcContextId,
  listAppDaemonContextsInIntermediateRoot,
  rememberOwnedRdcDaemon,
  listOwnedRdcDaemons,
} from './OwnedRdcDaemonRegistry';

const tempDirs: string[] = [];
const makeRoot = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-owned-daemon-'));
  tempDirs.push(root);
  return root;
};
afterEach(() => {
  for (const root of tempDirs.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const contextId = 'rdc-11111111-2222-3333-4444-555555555555';
const otherId = 'rdc-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

describe('OwnedRdcDaemonRegistry', () => {
  it('accepts only application rdc-uuid contexts', () => {
    expect(isAppRdcContextId(contextId)).toBe(true);
    expect(isAppRdcContextId('default')).toBe(false);
    expect(isAppRdcContextId('task-123')).toBe(false);
  });

  it('lists only rdc-* daemon state files from the App intermediate root', () => {
    const intermediateRoot = path.join(makeRoot(), 'rdc-tool-intermediate');
    const runtime = path.join(intermediateRoot, 'runtime', 'rdc_cli');
    fs.mkdirSync(runtime, { recursive: true });
    fs.writeFileSync(path.join(runtime, `daemon_state_${contextId}.json`), '{}');
    fs.writeFileSync(path.join(runtime, 'daemon_state.json'), '{}');
    fs.writeFileSync(path.join(runtime, 'daemon_state_other.json'), '{}');
    expect(listAppDaemonContextsInIntermediateRoot(intermediateRoot)).toEqual([contextId]);
  });

  it('harvests only the target context through official clear then stop', async () => {
    const root = makeRoot();
    const intermediateRoot = path.join(root, 'rdc-tool-intermediate');
    const registryPath = path.join(root, 'owned-rdc-daemons.json');
    rememberOwnedRdcDaemon({
      contextId, command: 'rdc', intermediateRoot, ownerPid: process.pid, daemonPid: 1, workerPid: 2, startedAt: 1,
    }, { registryPath });
    rememberOwnedRdcDaemon({
      contextId: otherId, command: 'rdc', intermediateRoot, ownerPid: process.pid, daemonPid: 3, workerPid: 4, startedAt: 1,
    }, { registryPath });
    const execute = vi.fn(async (command: string, args: string[]) => {
      const id = args[args.lastIndexOf('--daemon-context') + 1];
      const kind = command === 'context' ? 'rdc_tool.context.clear' : 'rdc_tool.daemon.stop';
      return { exitCode: 0, stdout: JSON.stringify({ ok: true, result_kind: kind, data: { context_id: id, stopped: true } }), stderr: '', duration_ms: 1 };
    });
    const result = await harvestOwnedRdcDaemons({
      registryPath,
      intermediateRoot,
      execute: execute as never,
      settings: { enabled: true, command: 'rdc', argsPrefix: [], workingDirectory: '', env: {}, timeoutMs: 1_000 },
    });
    expect(result.released.sort()).toEqual([otherId, contextId].sort());
    expect(result.failed).toEqual([]);
    expect(execute.mock.calls.filter((call) => call[0] === 'context')).toHaveLength(2);
    expect(execute.mock.calls.filter((call) => call[0] === 'daemon')).toHaveLength(2);
    expect(execute.mock.calls.every((call) => {
      const id = call[1][call[1].lastIndexOf('--daemon-context') + 1];
      return id === contextId || id === otherId;
    })).toBe(true);
  });

  it('kills only command-line verified leftover pids when the recorded CLI is gone', async () => {
    const root = makeRoot();
    const registryPath = path.join(root, 'owned-rdc-daemons.json');
    rememberOwnedRdcDaemon({
      contextId,
      command: path.join(root, 'missing-rdc-tool.exe'),
      intermediateRoot: path.join(root, 'rdc-tool-intermediate'),
      ownerPid: process.pid,
      daemonPid: 91,
      workerPid: 92,
      startedAt: 1,
    }, { registryPath });
    const killed: number[] = [];
    const result = await harvestOwnedRdcDaemons({
      registryPath,
      intermediateRoot: path.join(root, 'rdc-tool-intermediate'),
      readCommandLine: (pid) => pid === 91
        ? `python -m rdc_tool.daemon.server --daemon-context ${contextId}`
        : `python -m rdc.runtime_worker --context-id ${contextId}`,
      killPid: (pid) => {
        killed.push(pid);
        return true;
      },
    });
    expect(result.failed).toEqual([]);
    expect(killed.sort()).toEqual([91, 92]);
  });

  it('keeps the record when leftover pids are not a confirmed owned daemon', async () => {
    const root = makeRoot();
    const registryPath = path.join(root, 'owned-rdc-daemons.json');
    rememberOwnedRdcDaemon({
      contextId,
      command: path.join(root, 'missing-rdc-tool.exe'),
      intermediateRoot: path.join(root, 'rdc-tool-intermediate'),
      ownerPid: process.pid,
      daemonPid: 91,
      workerPid: 92,
      startedAt: 1,
    }, { registryPath });
    const killed: number[] = [];
    const result = await harvestOwnedRdcDaemons({
      registryPath,
      intermediateRoot: path.join(root, 'rdc-tool-intermediate'),
      readCommandLine: () => 'notepad.exe',
      killPid: (pid) => {
        killed.push(pid);
        return true;
      },
    });
    expect(result.released).toEqual([]);
    expect(result.failed).toEqual([expect.objectContaining({ contextId })]);
    expect(killed).toEqual([]);
    expect(listOwnedRdcDaemons({ registryPath }).map((record) => record.contextId)).toEqual([contextId]);
  });
});

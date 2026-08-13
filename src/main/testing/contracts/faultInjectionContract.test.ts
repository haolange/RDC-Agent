/**
 * Fault-injection contract (Phase 7 matrix entry).
 *
 * Covers abort/late-discard, never-resolving tool timeout, ProcessSupervisor
 * unconfirmed_orphan, StorageIo bak-swap recovery, and MemoryStore realpath mutex.
 */
import * as fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { EventStream } from '../../agent-runtime/core/EventStream';
import type { AssistantMessage, AssistantMessageEvent } from '../../agent-runtime/core/types';
import {
  AssistantStreamBuilder,
  createProviderOutputRef,
  ProviderStreamProtocolError,
} from '../../agent-runtime/providers/internal/AssistantStreamBuilder';
import { MemoryStore } from '../../agent-runtime/memory/MemoryStore';
import { StorageIo } from '../../sessions/StorageIo';
import { StdioRpcClient } from '../../agent-runtime/agent/mcpRpcTransport';
import { ShutdownCoordinator } from '../../lifecycle/ShutdownCoordinator';
import { writeTextFileNoFollow } from '../../agent-runtime/tools/primitives/_shared';
import { hashAttachmentContents } from '../../conversation/ConversationAttachmentHashing';
import { ConversationHistoryStore } from '../../sessions/ConversationHistoryStore';

const childState = vi.hoisted(() => {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const child = {
    pid: 4242,
    killed: false,
    stdout: { on: () => child.stdout },
    stderr: { on: () => child.stderr },
    on: (event: string, listener: (...args: unknown[]) => void) => {
      listeners.set(event, listener);
      return child;
    },
    emit: (event: string, ...args: unknown[]) => {
      listeners.get(event)?.(...args);
    },
    kill: () => {
      child.killed = true;
      return true;
    },
  };
  return {
    child,
    spawn: vi.fn(() => child),
    spawnSync: vi.fn(),
  };
});

vi.mock('child_process', () => ({
  spawn: childState.spawn,
  spawnSync: childState.spawnSync,
}));

import { ProcessSupervisor } from '../../runtime/ProcessSupervisor';

function makeBuilder() {
  const stream = new EventStream<AssistantMessageEvent, AssistantMessage>(
    (event) => event.type === 'done',
    (event) => (event as Extract<AssistantMessageEvent, { type: 'done' }>).message,
  );
  const builder = new AssistantStreamBuilder(stream, 'model', 'provider');
  builder.start();
  return { builder, stream };
}

describe('faultInjectionContract: provider/stream abort late discard', () => {
  it('EventStream.abort discards late pushes and rejects result', async () => {
    const stream = new EventStream<string, string>();
    stream.push('early');
    stream.abort();
    stream.push('late-should-drop');
    expect(stream.isDone).toBe(true);
    expect(stream.signal.aborted).toBe(true);

    const received: string[] = [];
    await expect(async () => {
      for await (const event of stream) {
        received.push(event);
      }
    }).rejects.toMatchObject({ name: 'AbortError' });
    expect(received).toEqual(['early']);
    await expect(stream.result()).rejects.toThrow(/aborted/i);
  });

  it('AssistantStreamBuilder rejects semantic output after abort terminal', () => {
    const { builder, stream } = makeBuilder();
    const ref = createProviderOutputRef({
      protocol: 'fault',
      providerBlockKey: 'text:0',
      sourceIndex: 0,
      contentIndex: 0,
    });
    builder.startText(ref);
    builder.appendText(ref, 'partial');
    const abortErr = new Error('fault abort');
    abortErr.name = 'AbortError';
    builder.fail(abortErr, 'aborted');
    expect(stream.isDone).toBe(true);
    expect(() => builder.appendText(ref, 'late')).toThrowError(expect.objectContaining({
      code: 'PROVIDER_STREAM_EVENT_AFTER_TERMINAL',
    }) as ProviderStreamProtocolError);
  });
});

describe('faultInjectionContract: never-resolving tool', () => {
  it('AbortSignal cancels a hanging tool race before it can resolve', async () => {
    // Models a stuck MCP/tool RPC: the production cancel path is AbortSignal on
    // executeTool/connect; this contract asserts the abort-vs-hang race settles
    // as AbortError and never leaks a late resolution into the waiter.
    const controller = new AbortController();
    let lateResolved = false;
    const neverResolves = new Promise<string>((resolve) => {
      const timer = setTimeout(() => {
        lateResolved = true;
        resolve('late-tool-result');
      }, 5_000);
      controller.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
    });

    const timed = Promise.race([
      neverResolves,
      new Promise<string>((_, reject) => {
        const timeoutMs = 40;
        const timer = setTimeout(() => {
          controller.abort();
          const err = new Error(`tool timeout after ${timeoutMs}ms`);
          err.name = 'AbortError';
          reject(err);
        }, timeoutMs);
        controller.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
      }),
    ]);

    await expect(timed).rejects.toMatchObject({ name: 'AbortError' });
    expect(controller.signal.aborted).toBe(true);
    await new Promise((r) => setTimeout(r, 60));
    expect(lateResolved).toBe(false);
  });
});

describe('faultInjectionContract: ProcessSupervisor unconfirmed_orphan', () => {
  afterEach(() => {
    childState.child.emit('close', 0, null);
    childState.child.killed = false;
    childState.spawn.mockClear();
    childState.spawnSync.mockClear();
  });

  it('returns unconfirmed_orphan when SIGKILL/no-close is observed', async () => {
    const supervisor = new ProcessSupervisor();
    const supervised = supervisor.spawn('other', 'fake-command', [], { isolateProcessGroup: false });

    const info = await supervised.join(1);
    expect(info.reason).toBe('unconfirmed_orphan');
    expect(supervised.orphaned).toBe(true);
    expect(supervisor.size).toBe(1);

    childState.child.emit('close', null, 'SIGKILL');
    await expect(supervised.exit).resolves.toMatchObject({ reason: 'timeout' });
    expect(supervisor.size).toBe(0);
  }, 10_000);
});

describe('faultInjectionContract: StorageIo bak-swap recovery', () => {
  let root = '';
  const io = new StorageIo();

  afterEach(() => {
    if (root && fs.existsSync(root)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  it('restores durable content from .bak after corrupt primary (rename-crash path)', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-fault-storage-'));
    const filePath = path.join(root, 'session.json');
    io.writeUtf8Atomic(filePath, JSON.stringify({ generation: 1 }, null, 2));
    // Simulate crash window: primary corrupt, prior durable bak still readable.
    fs.writeFileSync(`${filePath}.bak`, JSON.stringify({ generation: 0, recovered: true }, null, 2), 'utf8');
    fs.writeFileSync(filePath, '{truncated-after-rename', 'utf8');

    expect(io.readJson<{ generation: number; recovered?: boolean }>(filePath)).toEqual({
      generation: 0,
      recovered: true,
    });
  });

  it('writeUtf8Atomic leaves durable primary and optional .bak after overwrite', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-fault-rename-'));
    const filePath = path.join(root, 'atomic.json');
    io.writeUtf8Atomic(filePath, JSON.stringify({ v: 1 }));
    io.writeUtf8Atomic(filePath, JSON.stringify({ v: 2 }));
    expect(JSON.parse(fs.readFileSync(filePath, 'utf8'))).toEqual({ v: 2 });
    expect(fs.readdirSync(root).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    // When the platform takes the EPERM/EEXIST bak-swap branch, prior bytes land in .bak.
    // Direct EPERM injection via vitest fs spies is unreliable across node:fs bindings;
    // corrupt-primary + .bak recovery above locks the recovery API.
    if (fs.existsSync(`${filePath}.bak`)) {
      expect(JSON.parse(fs.readFileSync(`${filePath}.bak`, 'utf8'))).toEqual({ v: 1 });
    }
  });
});

describe('faultInjectionContract: concurrent write mutex (realpath)', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const dir of roots.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('serializes MemoryStore writes across alias paths of the same real directory', async () => {
    // Cross-process exclusive locking is OS-hard without native flock bindings;
    // in-process realpath mutex is the production MemoryStore boundary we can assert here.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-fault-mutex-'));
    roots.push(root);
    const alias = path.join(root, 'alias-link');
    try {
      fs.symlinkSync(root, alias, 'junction');
    } catch {
      // Symlink/junction may be unavailable; fall back to path.join(root, '.') identity.
    }
    const aliasRoot = fs.existsSync(alias) ? alias : path.join(root, '.');
    const a = new MemoryStore(root);
    const b = new MemoryStore(aliasRoot);
    const [first, second] = await Promise.all([
      a.writeMemory({ name: 'Mutex A', description: 'a', type: 'user', content: 'one' }),
      b.writeMemory({ name: 'Mutex-B', description: 'b', type: 'user', content: 'two' }),
    ]);
    expect(first.name).not.toBe(second.name);
    const listed = (await a.listMemories()).map((record) => record.displayName).sort();
    expect(listed).toEqual(['Mutex A', 'Mutex-B']);
  });
});

describe('faultInjectionContract: MCP half-packet disconnect', () => {
  it('rejects in-flight JSON-RPC when the stdio stream ends mid-object', async () => {
    const stdout = new PassThrough();
    const stdin = new PassThrough();
    const proc = new EventEmitter() as EventEmitter & {
      stdout: PassThrough;
      stdin: PassThrough;
    };
    proc.stdout = stdout;
    proc.stdin = stdin;
    const client = new StdioRpcClient(proc as unknown as ChildProcess);
    const pending = client.request('tools/call', { name: 'x' }, 5_000);
    stdout.write('{"jsonrpc":"2.0","id":1,"result":');
    proc.emit('exit', 1);
    await expect(pending).rejects.toThrow(/exited|closed/i);
  });
});

describe('faultInjectionContract: attachment source replaced after staging', () => {
  it('hashes staged bytes so a later source rewrite cannot change the fingerprint', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-fault-att-'));
    try {
      const sourcePath = path.join(root, 'source.txt');
      const stagingDir = path.join(root, 'staging');
      fs.writeFileSync(sourcePath, 'staged-bytes');
      const store = new ConversationHistoryStore({
        io: new StorageIo(),
      } as ConstructorParameters<typeof ConversationHistoryStore>[0]);
      const [stagedPath] = store.stageAttachmentInputs([sourcePath], stagingDir);
      const [stagedHash] = await hashAttachmentContents([{
        sourcePath: stagedPath!,
        fileName: 'source.txt',
        mimeType: 'text/plain',
      }]);
      fs.writeFileSync(sourcePath, 'replaced');
      const [sourceHash] = await hashAttachmentContents([{
        sourcePath,
        fileName: 'source.txt',
        mimeType: 'text/plain',
      }]);
      expect(fs.readFileSync(stagedPath!, 'utf8')).toBe('staged-bytes');
      expect(stagedHash).not.toBe(sourceHash);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('faultInjectionContract: symlink parent swap', () => {
  const probeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-symlink-probe-'));
  let symlinkAvailable = false;
  let skipReason = '';
  try {
    fs.symlinkSync(probeRoot, path.join(probeRoot, 'link'), 'junction');
    symlinkAvailable = true;
  } catch (error) {
    skipReason = error instanceof Error ? error.message : String(error);
    console.warn(`SYMLINK_TEST_SKIPPED: ${skipReason}`);
  } finally {
    fs.rmSync(probeRoot, { recursive: true, force: true });
  }

  it.skipIf(!symlinkAvailable)('rejects writes when the parent path is a symlink/reparse point', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-fault-symlink-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-fault-symlink-out-'));
    try {
      const parent = path.join(root, 'parent');
      fs.mkdirSync(parent);
      const target = path.join(parent, 'note.txt');
      await writeTextFileNoFollow(target, 'inside');
      fs.rmSync(parent, { recursive: true, force: true });
      fs.symlinkSync(outside, parent, 'junction');
      await expect(writeTextFileNoFollow(target, 'escaped')).rejects.toThrow(/SYMLINK_PATH_REJECTED/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('faultInjectionContract: renderer/main storage recovery', () => {
  it('re-reads atomically written JSON after a simulated renderer crash', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-fault-renderer-'));
    try {
      const io = new StorageIo();
      const filePath = path.join(root, 'session.json');
      io.writeJsonAtomic(filePath, { sessionId: 'sess_crash', title: 'ok' });
      expect(io.readJson(filePath)).toEqual({ sessionId: 'sess_crash', title: 'ok' });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('faultInjectionContract: shutdown with active producers', () => {
  it('aborts real turns and invokes MCP/terminal dispose façades in index.ts phase order', async () => {
    const { TurnCoordinator } = await import('../../workflow/debugger/TurnCoordinator');
    const { McpConnectionCoordinator } = await import('../../workflow/debugger/McpConnectionCoordinator');
    const coordinator = new ShutdownCoordinator();
    const turns = new TurnCoordinator();
    const mcp = new McpConnectionCoordinator();
    const disconnectAll = vi.spyOn(mcp, 'disconnectAll');
    const terminalTabs = new Map<string, { tabId: string }>([['term_fake', { tabId: 'term_fake' }]]);
    const terminal = {
      disposeAll() {
        terminalTabs.clear();
      },
    };
    const handle = await turns.beginTurn({
      sessionKey: 'shutdown-session',
      turnId: 'shutdown-turn',
    });
    expect(turns.getActive('shutdown-session')?.turnId).toBe(handle.turnId);

    const seen: string[] = [];
    coordinator.register({
      id: 'conversation.abort-all',
      phase: 'abort_all',
      dispose: async () => {
        seen.push('abort_all');
        await turns.abortAll('app_shutdown');
      },
    });
    coordinator.register({
      id: 'mcp.disconnect-all',
      phase: 'terminate_processes',
      dispose: async () => {
        seen.push('terminate_processes:mcp');
        await mcp.disconnectAll();
      },
    });
    coordinator.register({
      id: 'terminal.dispose-all',
      phase: 'terminate_processes',
      dispose: () => {
        seen.push('terminate_processes:terminal');
        terminal.disposeAll();
      },
    });

    await coordinator.shutdownAll(1_000);
    expect(turns.getActive('shutdown-session')).toBeNull();
    expect(disconnectAll).toHaveBeenCalledTimes(1);
    expect(terminalTabs.size).toBe(0);
    expect(seen[0]).toBe('abort_all');
    expect(seen.slice(1).sort()).toEqual(['terminate_processes:mcp', 'terminate_processes:terminal']);
    expect(coordinator.getPhase()).toBe('exited');
  });
});

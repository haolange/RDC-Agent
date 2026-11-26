import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useTerminalStore } from './terminalStore';
import type { RuntimeLogEntry } from '@shared/types/runtimeLog';

const entry = (sessionId: string): RuntimeLogEntry => ({
  id: `entry-${sessionId}`,
  timestamp: 1,
  scope: 'session',
  namespace: 'agent',
  severity: 'info',
  title: sessionId,
  summary: sessionId,
  sessionId,
  projectId: 'project-a',
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
};

const originalWindow = (globalThis as { window?: unknown }).window;

describe('terminalStore session isolation', () => {
  beforeEach(() => {
    useTerminalStore.setState({
      scopeFilter: 'current-session',
      sessionId: null,
      projectId: null,
      runId: null,
      entries: [],
      expandedEntryIds: [],
      isLoading: false,
    });
  });

  afterEach(() => {
    if (originalWindow === undefined) {
      Reflect.deleteProperty(globalThis, 'window');
      return;
    }
    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
  });

  it('clears current-session entries synchronously when the active session changes', () => {
    useTerminalStore.setState({
      sessionId: 'session-a',
      projectId: 'project-a',
      entries: [entry('session-a')],
      expandedEntryIds: ['entry-session-a'],
      isLoading: true,
    });

    useTerminalStore.getState().setActiveContext({
      sessionId: 'session-b',
      projectId: 'project-a',
      runId: null,
    });

    expect(useTerminalStore.getState()).toMatchObject({
      sessionId: 'session-b',
      entries: [],
      expandedEntryIds: [],
      isLoading: false,
    });
  });

  it('drops an old session refresh after the active context changes', async () => {
    const pending = deferred<{ entries: RuntimeLogEntry[] }>();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        electronAPI: {
          runtimeLog: {
            list: () => pending.promise,
          },
        },
      },
    });
    useTerminalStore.getState().setActiveContext({
      sessionId: 'session-a',
      projectId: 'project-a',
      runId: null,
    });

    const refresh = useTerminalStore.getState().refreshEntries();
    useTerminalStore.getState().setActiveContext({
      sessionId: 'session-b',
      projectId: 'project-a',
      runId: null,
    });
    pending.resolve({ entries: [entry('session-a')] });
    await refresh;

    expect(useTerminalStore.getState().entries).toEqual([]);
    expect(useTerminalStore.getState().isLoading).toBe(false);
  });
});

describe('terminalStore refresh', () => {
  afterEach(() => {
    if (originalWindow === undefined) {
      Reflect.deleteProperty(globalThis, 'window');
      return;
    }
    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
  });

  it('keeps lines that streamed in while the list was in flight', async () => {
    const pending = deferred<{ entries: RuntimeLogEntry[] }>();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { electronAPI: { runtimeLog: { list: () => pending.promise } } },
    });
    const stale = { ...entry('session-a'), id: 'stale' };
    useTerminalStore.setState({
      scopeFilter: 'current-session',
      sessionId: 'session-a',
      projectId: 'project-a',
      runId: null,
      entries: [stale],
      expandedEntryIds: [],
      isLoading: false,
    });

    const refresh = useTerminalStore.getState().refreshEntries();
    const streamed = { ...entry('session-a'), id: 'streamed' };
    const listedAndStreamed = { ...entry('session-a'), id: 'both' };
    useTerminalStore.getState().appendEntry(streamed);
    useTerminalStore.getState().appendEntry(listedAndStreamed);
    pending.resolve({ entries: [{ ...entry('session-a'), id: 'listed' }, listedAndStreamed] });
    await refresh;

    expect(useTerminalStore.getState().entries.map((item) => item.id)).toEqual(['listed', 'both', 'streamed']);
  });
});

import { describe, expect, it, vi } from 'vitest';

const log = vi.hoisted(() => vi.fn());
const showErrorBox = vi.hoisted(() => vi.fn());
vi.mock('electron', () => ({ dialog: { showErrorBox } }));
vi.mock('./RuntimeLogService', () => ({ runtimeLogService: { log } }));

import { installProcessFaultHandlers } from './processFaultHandlers';

describe('process fault handlers', () => {
  it('writes unhandled rejections and uncaught exceptions to the runtime log, and shows uncaught ones', () => {
    const listeners = new Map<string, (fault: unknown) => void>();
    // Capture the listeners instead of registering them on the test runner's own process.
    const on = vi.spyOn(process, 'on').mockImplementation(((event: string, listener: (fault: unknown) => void) => {
      listeners.set(event, listener);
      return process;
    }) as typeof process.on);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    installProcessFaultHandlers();
    on.mockRestore();

    listeners.get('unhandledRejection')!(new Error('lost promise'));
    listeners.get('uncaughtException')!(new Error('broken state'));

    expect(log.mock.calls.map(([entry]) => [entry.severity, entry.title, entry.summary])).toEqual([
      ['error', 'Unhandled promise rejection in main', 'lost promise'],
      ['error', 'Uncaught exception in main', 'broken state'],
    ]);
    expect(showErrorBox).toHaveBeenCalledTimes(1);
  });
});

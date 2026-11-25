/**
 * POSIX process primitives. On Linux the birth is
 * `linux-start-ticks:<boot_id>:<stat field 22>`, the form RDC-Tool records;
 * a zombie (state Z/X) has exited. Hosts without /proc cannot read births,
 * so identity there stays unknown rather than guessed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { AppError } from '@shared/errors/appError';
import type { ProcessBackend } from './processBackend';

export interface PosixProcessDeps {
  procRoot: string;
  readFile: (filePath: string) => string;
  kill: (pid: number, signal: number | NodeJS.Signals) => boolean;
  selfPid: number;
}

const defaultDeps: PosixProcessDeps = {
  procRoot: '/proc',
  readFile: (filePath) => fs.readFileSync(filePath, 'utf8'),
  kill: (pid, signal) => process.kill(pid, signal),
  selfPid: process.pid,
};

interface ProcStat {
  state: string;
  processGroup: number;
  startTicks: string;
}

function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'ENOENT' || code === 'ESRCH';
}

export function createPosixProcessBackend(deps: PosixProcessDeps = defaultDeps): ProcessBackend {
  let bootId: string | undefined;
  const procFile = (...segments: string[]): string => path.posix.join(deps.procRoot, ...segments);
  const hasProc = (): boolean => {
    try {
      deps.readFile(procFile('self', 'stat'));
      return true;
    } catch {
      return false;
    }
  };
  const readStat = (pid: number): ProcStat | null => {
    let text: string;
    try {
      text = deps.readFile(procFile(String(pid), 'stat'));
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
    // Fields after the parenthesised command name start at field 3 (state).
    const fields = text.slice(text.lastIndexOf(')') + 2).trim().split(/\s+/);
    if (fields.length < 20) throw new AppError('PROCESS_QUERY_FAILED', `malformed stat for pid ${pid}.`);
    return { state: fields[0]!, processGroup: Number(fields[2]), startTicks: fields[19]! };
  };
  const liveStat = (pid: number): ProcStat | null => {
    const stat = readStat(pid);
    return stat && stat.state !== 'Z' && stat.state !== 'X' ? stat : null;
  };
  const signalExists = (pid: number): boolean => {
    try {
      deps.kill(pid, 0);
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ESRCH') return false;
      if (code === 'EPERM') return true;
      throw error;
    }
  };

  return {
    isRunning(pid) {
      return hasProc() ? liveStat(pid) !== null : signalExists(pid);
    },
    readBirth(pid) {
      if (!hasProc()) throw new AppError('PROCESS_QUERY_UNAVAILABLE', 'process birth requires /proc.');
      const stat = liveStat(pid);
      if (!stat) return null;
      bootId ??= deps.readFile(procFile('sys', 'kernel', 'random', 'boot_id')).trim();
      return `linux-start-ticks:${bootId}:${stat.startTicks}`;
    },
    readCommandLine(pid) {
      try {
        const commandLine = deps.readFile(procFile(String(pid), 'cmdline')).replace(/\0/g, ' ').trim();
        return commandLine || null;
      } catch {
        return null;
      }
    },
    killTree(pid) {
      const stat = hasProc() ? liveStat(pid) : null;
      const ownGroup = hasProc() ? readStat(deps.selfPid)?.processGroup : undefined;
      // A detached daemon leads its own group; its worker stays in it, so one group kill reaps both.
      const target = stat && stat.processGroup === pid && pid !== ownGroup ? -pid : pid;
      try {
        deps.kill(target, 'SIGKILL');
        return true;
      } catch {
        return false;
      }
    },
    signalChildTree(pid, signal) {
      try {
        deps.kill(-pid, signal);
      } catch {
        try {
          deps.kill(pid, signal);
        } catch {
          // The child already exited; ProcessSupervisor observes close.
        }
      }
    },
    childGroupOptions: { detached: true },
  };
}

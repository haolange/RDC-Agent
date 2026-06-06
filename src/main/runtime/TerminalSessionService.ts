import { app, BrowserWindow } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { generateShortId, nowMs } from '@shared/utils/id';
import type { TerminalCreateTabRequest, TerminalDataEvent, TerminalExitEvent, TerminalTabRecord } from '@shared/types/terminal';
import { storageAdapter } from '../sessions/StorageAdapter';
import { rendererEventHub } from '../browserAppBridge/rendererEventHub';

interface ShellTabState {
  record: TerminalTabRecord;
  process: ChildProcessWithoutNullStreams;
  cols: number;
  rows: number;
}

const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 32;

function resolvePowerShellPath(): string {
  const systemRoot = process.env.SystemRoot?.trim() || process.env.windir?.trim() || 'C:\\Windows';
  const candidates = [
    path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    path.join(systemRoot, 'Sysnative', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
  ];

  const resolved = candidates.find((candidate) => fs.existsSync(candidate));
  return resolved ?? 'powershell.exe';
}

function isDirectory(targetPath: string): boolean {
  try {
    return fs.statSync(targetPath).isDirectory();
  } catch {
    return false;
  }
}

function resolveTerminalCwd(requestedCwd?: string | null): string {
  const candidates = [
    requestedCwd?.trim(),
    storageAdapter.getWorkspacePath(),
    app.getPath('userData'),
    process.cwd(),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (isDirectory(resolved)) {
      return resolved;
    }
  }

  return process.cwd();
}

function buildTabTitle(cwd: string): string {
  return `PowerShell: ${cwd}`;
}

export class TerminalSessionService {
  private tabs = new Map<string, ShellTabState>();

  listTabs(): TerminalTabRecord[] {
    return Array.from(this.tabs.values())
      .map((entry) => entry.record)
      .sort((left, right) => left.createdAt - right.createdAt);
  }

  createTab(options?: TerminalCreateTabRequest): TerminalTabRecord {
    const cwd = resolveTerminalCwd(options?.cwd);
    const tabId = `term_${generateShortId()}`;
    const shellPath = resolvePowerShellPath();
    const child = spawn(shellPath, ['-NoLogo'], {
      cwd,
      stdio: 'pipe',
      windowsHide: true,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
      },
    });

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    const record: TerminalTabRecord = {
      tabId,
      kind: 'shell',
      title: buildTabTitle(cwd),
      cwd,
      status: 'running',
      createdAt: nowMs(),
      sessionId: options?.sessionId ?? null,
      projectId: options?.projectId ?? null,
      runId: options?.runId ?? null,
    };

    const tabState: ShellTabState = {
      record,
      process: child,
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
    };

    child.stdout.on('data', (chunk: string) => {
      this.broadcastData({ tabId, data: chunk });
    });

    child.stderr.on('data', (chunk: string) => {
      this.broadcastData({ tabId, data: chunk });
    });

    child.on('error', (error) => {
      const current = this.tabs.get(tabId);
      if (!current) {
        return;
      }

      current.record = {
        ...current.record,
        status: 'exited',
        exitCode: null,
      };
      this.broadcastData({
        tabId,
        data: `\r\n[terminal failed to start: ${error.message}]\r\n`,
      });
      this.broadcastExit({ tabId, exitCode: null });
      this.broadcastTabsChanged();
    });

    child.on('close', (exitCode) => {
      const current = this.tabs.get(tabId);
      if (!current) {
        return;
      }

      current.record = {
        ...current.record,
        status: 'exited',
        exitCode,
      };
      this.broadcastExit({ tabId, exitCode });
      this.broadcastTabsChanged();
    });

    this.tabs.set(tabId, tabState);
    this.broadcastTabsChanged();
    return record;
  }

  closeTab(tabId: string): TerminalTabRecord[] {
    const tab = this.tabs.get(tabId);
    if (!tab) {
      return this.listTabs();
    }

    if (tab.record.status === 'running') {
      tab.process.stdin.write('exit\r\n');
      tab.process.kill();
    }

    this.tabs.delete(tabId);
    this.broadcastTabsChanged();
    return this.listTabs();
  }

  activateTab(_tabId: string): TerminalTabRecord[] {
    return this.listTabs();
  }

  write(tabId: string, data: string): void {
    const tab = this.tabs.get(tabId);
    if (!tab || tab.record.status !== 'running') {
      return;
    }
    tab.process.stdin.write(data);
  }

  resize(tabId: string, cols: number, rows: number): void {
    const tab = this.tabs.get(tabId);
    if (!tab) {
      return;
    }
    tab.cols = cols;
    tab.rows = rows;
  }

  disposeAll(): void {
    for (const tabId of Array.from(this.tabs.keys())) {
      this.closeTab(tabId);
    }
  }

  private broadcastData(payload: TerminalDataEvent): void {
    rendererEventHub.emit('terminal:data', payload);
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('terminal:data', payload);
      }
    }
  }

  private broadcastExit(payload: TerminalExitEvent): void {
    rendererEventHub.emit('terminal:exit', payload);
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('terminal:exit', payload);
      }
    }
  }

  private broadcastTabsChanged(): void {
    const tabs = this.listTabs();
    rendererEventHub.emit('terminal:tabsChanged', { tabs });
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('terminal:tabsChanged', { tabs });
      }
    }
  }
}

export const terminalSessionService = new TerminalSessionService();

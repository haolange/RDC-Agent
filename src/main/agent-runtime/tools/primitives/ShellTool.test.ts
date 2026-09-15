import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const cwdBySession = vi.hoisted(() => new Map<string, string>());

vi.mock('electron', () => ({
  app: {
    getAppPath: () => process.cwd(),
    getPath: () => process.env.TEMP ?? process.cwd(),
  },
}));
vi.mock('../../../sessions/StorageAdapter', () => ({
  storageAdapter: {
    readSessionShellCwd: (sessionId: string) => cwdBySession.get(sessionId) ?? null,
    writeSessionShellCwd: (sessionId: string, cwd: string) => {
      cwdBySession.set(sessionId, cwd);
    },
  },
}));
import type { ToolExecutionContext } from '../../agent/AgentTool';
import { shellTool } from './ShellTool';
import {
  isPathInsideRoot,
  parseShellTrailer,
  wrapPosixCommand,
  wrapPowerShellCommand,
} from './shellTrailer';

const roots: string[] = [];
afterEach(async () => {
  cwdBySession.clear();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('shellTrailer', () => {
  it('strips a GUID trailer and reads cwd, provider, and exit', () => {
    const marker = 'RDX_SHELL_TESTMARKER';
    const parsed = parseShellTrailer(
      `hello\n${marker}\ncwd=D:\\\\proj\nprovider=FileSystem\nexit=7\n`,
      marker,
    );
    expect(parsed.body).toBe('hello');
    expect(parsed.trailer).toEqual({
      cwd: 'D:\\\\proj',
      provider: 'FileSystem',
      exit: 7,
    });
    const crlf = parseShellTrailer(
      `hello\r\n${marker}\r\ncwd=D:\\\\proj\r\nprovider=FileSystem\r\nexit=0\r\n`,
      marker,
    );
    expect(crlf.body).toBe('hello');
    expect(crlf.trailer?.exit).toBe(0);
  });

  it('normalizes CRLF even when the trailer marker is missing', () => {
    const parsed = parseShellTrailer('hello\r\nworld\r\n', 'RDX_SHELL_ABSENT');
    expect(parsed.trailer).toBeNull();
    expect(parsed.body).toBe('hello\nworld\n');
  });

  it('registers a POSIX EXIT trap, begin marker, and explicit cd', () => {
    const wrapped = wrapPosixCommand('/tmp/rdc-agent-shell-x/command.sh', 'RDX_SHELL_POSIX', '/tmp/proj');
    expect(wrapped).toContain("trap '__exit=$?; __emit' EXIT");
    expect(wrapped).toContain('pwd -P');
    expect(wrapped).toContain("printf '%s\\n' \"$__begin\"");
    expect(wrapped).toContain("cd '/tmp/proj'");
    expect(wrapped).not.toContain('mktemp');
    expect(wrapped).not.toContain('base64');
    expect(wrapped).not.toContain('LANG=');
  });

  it('strips login-profile banner before the begin marker', () => {
    const marker = 'RDX_SHELL_POSIX';
    const parsed = parseShellTrailer(
      `Welcome to zsh\n${marker}_BEGIN\nhello\n${marker}\ncwd=/tmp/proj\nprovider=FileSystem\nexit=0\n`,
      marker,
    );
    expect(parsed.body).toBe('hello');
    expect(parsed.trailer?.cwd).toBe('/tmp/proj');
    expect(parsed.body).not.toContain('Welcome to zsh');
  });

  it('rejects a cwd that escaped the project root', () => {
    expect(isPathInsideRoot('D:\\Projects\\other', 'D:\\Projects\\app')).toBe(false);
    expect(isPathInsideRoot('D:\\Projects\\app\\src', 'D:\\Projects\\app')).toBe(true);
  });

  it('treats a non-FileSystem provider as unusable persisted cwd', () => {
    const parsed = parseShellTrailer(
      `ok\nRDX_SHELL_X\ncwd=HKLM:\\SOFTWARE\nprovider=Registry\nexit=0\n`,
      'RDX_SHELL_X',
    );
    expect(parsed.trailer?.provider).toBe('Registry');
    expect(parsed.trailer?.provider).not.toBe('FileSystem');
  });

  it('writes UTF-8 through an independent StreamWriter and keeps 5.1 OEM decode', () => {
    const wrapped = wrapPowerShellCommand('Write-Output 中文', 'RDX_SHELL_UTF8');
    expect(wrapped).toContain('New-Object System.Text.UTF8Encoding $false');
    expect(wrapped).not.toContain('[Console]::OutputEncoding =');
    expect(wrapped).toContain('$PSNativeCommandUseErrorActionPreference = $false');
    expect(wrapped).toContain('[System.Text.Encoding]::Default');
    expect(wrapped).toContain('2>$__errFile');
    expect(wrapped).not.toContain('2>&1');
    expect(wrapped).toContain('$ErrorActionPreference = \'Stop\'');
    expect(wrapped).toContain('[Environment]::Exit($__exit)');
  });
});

describe('ShellTool', () => {
  it('runs a cross-platform echo and reports trailer exit 0', { timeout: 30_000 }, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdx-shell-tool-'));
    roots.push(root);
    const context: ToolExecutionContext = {
      workspaceRoot: root,
      projectRootPath: root,
      projectId: null,
      sessionId: null,
    };
    const command = process.platform === 'win32'
      ? 'Write-Output hello-rdx'
      : 'printf %s hello-rdx';
    const result = await shellTool.execute(
      's1',
      { command, timeout: 20_000 },
      undefined,
      undefined,
      context,
    );
    const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
    expect(text).toContain('hello-rdx');
    expect(text).not.toContain('RDX_SHELL_');
    expect(result.isError).not.toBe(true);
    expect(result.details).toMatchObject({
      exitCode: 0,
      cwd: expect.any(String),
      truncated: false,
    });
  });

  it('keeps a FileSystem trailer for Get-Location / pwd', { timeout: 30_000 }, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdx-shell-cwd-'));
    roots.push(root);
    const context: ToolExecutionContext = {
      workspaceRoot: root,
      projectRootPath: root,
      projectId: null,
      sessionId: null,
    };
    const command = process.platform === 'win32' ? 'Get-Location' : 'pwd';
    const result = await shellTool.execute(
      's-cwd',
      { command, timeout: 20_000 },
      undefined,
      undefined,
      context,
    );
    const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
    expect(text).not.toContain('trailer missing');
    expect(result.isError).not.toBe(true);
    expect(result.details?.exitCode).toBe(0);
    expect(result.details?.cwd).toBe(path.resolve(root));
  });

  it('does not declare run_in_background', () => {
    expect(shellTool.parameters.properties).not.toHaveProperty('run_in_background');
    expect(shellTool.name).toBe('shell');
  });

  it('keeps the tool parameter root as a plain object without oneOf/anyOf', () => {
    const parameters = shellTool.parameters as Record<string, unknown>;
    expect(parameters.type).toBe('object');
    expect(parameters).not.toHaveProperty('oneOf');
    expect(parameters).not.toHaveProperty('anyOf');
  });

  it('rejects mixed or empty command/rdx at execute time', async () => {
    await expect(shellTool.execute('s-empty', {}, undefined, undefined, {
      workspaceRoot: process.cwd(),
      projectRootPath: process.cwd(),
      projectId: null,
      sessionId: null,
    })).rejects.toThrow('exactly one of command or rdx');
    await expect(shellTool.execute('s-mixed', { command: 'echo', rdx: { operation: 'rd.core.init', args: {} } }, undefined, undefined, {
      workspaceRoot: process.cwd(),
      projectRootPath: process.cwd(),
      projectId: null,
      sessionId: null,
    })).rejects.toThrow('exactly one of command or rdx');
  });

  it('injects the resolved interpreter and host OS into the dynamic description', () => {
    expect(shellTool.description).toMatch(/Host OS:/);
    expect(shellTool.description).toMatch(/PowerShell|bash|sh|zsh|pwsh/i);
    expect(shellTool.description).toMatch(/Working directory persists/);
  });

  it('persists cwd across calls for the same session and heals an escaped state', { timeout: 30_000 }, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdx-shell-persist-'));
    roots.push(root);
    const nested = path.join(root, 'nested');
    await mkdir(nested);
    const context: ToolExecutionContext = {
      workspaceRoot: root,
      projectRootPath: root,
      projectId: null,
      sessionId: 'sess_shell_cwd',
    };
    cwdBySession.set('sess_shell_cwd', path.join(os.tmpdir(), 'outside-project'));
    const cd = process.platform === 'win32' ? 'Set-Location nested' : 'cd nested';
    const first = await shellTool.execute('s-persist-1', { command: cd, timeout: 20_000 }, undefined, undefined, context);
    expect(first.isError).not.toBe(true);
    expect(cwdBySession.get('sess_shell_cwd')).toBe(path.resolve(nested));
    const loc = process.platform === 'win32' ? 'Get-Location' : 'pwd';
    const second = await shellTool.execute('s-persist-2', { command: loc, timeout: 20_000 }, undefined, undefined, context);
    expect(second.details?.cwd).toBe(path.resolve(nested));
  });

  it('reports a non-zero exit when the user command exits 3', { timeout: 30_000 }, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdx-shell-exit-'));
    roots.push(root);
    const context: ToolExecutionContext = {
      workspaceRoot: root,
      projectRootPath: root,
      projectId: null,
      sessionId: null,
    };
    const result = await shellTool.execute(
      's-exit',
      { command: 'exit 3', timeout: 20_000 },
      undefined,
      undefined,
      context,
    );
    expect(result.isError).toBe(true);
    expect(result.details?.exitCode).toBe(3);
  });

  it('decodes Windows native OEM stdout without U+FFFD', { timeout: 30_000 }, async () => {
    if (process.platform !== 'win32') return;
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdx-shell-oem-'));
    roots.push(root);
    const context: ToolExecutionContext = {
      workspaceRoot: root,
      projectRootPath: root,
      projectId: null,
      sessionId: null,
    };
    const result = await shellTool.execute(
      's-oem',
      { command: 'ipconfig', timeout: 20_000 },
      undefined,
      undefined,
      context,
    );
    const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
    expect(text).not.toContain('\uFFFD');
    expect(text).toMatch(/以太网|Ethernet|适配器|adapter/i);
    expect(result.isError).not.toBe(true);
  });
  it('preserves PowerShell Unicode and caller-selected UTF-8 native output', { timeout: 30_000 }, async () => {
    if (process.platform !== 'win32') return;
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdx-shell-utf8-'));
    roots.push(root);
    const result = await shellTool.execute('s-utf8', {
      command: "Write-Output '中文样本'; [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); node -e \"process.stdout.write(String.fromCharCode(20013,25991))\"",
      timeout: 20_000,
    }, undefined, undefined, { workspaceRoot: root, projectRootPath: root, projectId: null, sessionId: null });
    const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
    expect(text).toContain('中文样本');
    expect(text.match(/中文/g)).toHaveLength(2);
    expect(text).not.toContain('\uFFFD');
    expect(result.isError).not.toBe(true);
  });

});

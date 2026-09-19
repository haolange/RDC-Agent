import { describe, expect, it } from 'vitest';
import { matchShellFileToolBypass } from './shellFileToolBypass';
const tools = ['read_file', 'grep', 'glob', 'edit_file', 'write_file'];
describe('dedicated file routing', () => {
  it.each(['cat', 'type', 'get-content', 'gc', 'head', 'tail', 'more', 'less',
    'rg', 'ripgrep', 'grep', 'findstr', 'select-string', 'sls', 'find', 'sed', 'awk',
    'set-content', 'sc', 'add-content', 'out-file', 'clear-content', 'tee-object'])('routes every declared command: %s', name => {
    for (const command of [name + ' input', '& "C:\\Tools\\' + name + '.exe" input',
      'pwsh -Command "' + name + ' input"', 'git status && ' + name + ' input']) {
      expect(matchShellFileToolBypass(command, 'pwsh', tools)).toContain('SHELL_FILE_TOOL_BYPASS');
    }
    expect(matchShellFileToolBypass('echo "' + name + ' input"', 'pwsh', tools)).toBeNull();
  });
  it.each(['rg x', 'Get-Content f', 'type f', 'git status; cat f', 'echo hi | findstr x',
    '& "C:\\Tools\\rg.exe" x', 'pwsh -Command "gc f"', 'cmd /c type f', 'head f && tail f',
    'Select-String x', 'Set-Content f x', 'sed x f', 'find .', 'g`c f'])('rejects %s', command => {
    expect(matchShellFileToolBypass(command, 'pwsh', tools)).toContain('SHELL_FILE_TOOL_BYPASS');
  });
  it.each(['rdx call rd.x', '& "C:\\Tools\\rdx.cmd" version', 'cmd /c rdx.exe version',
    'python "C:\\Tools\\cli\\run_cli.py" version', 'py cli/run_cli.py version', 'python -m rdx.cli version',
    'powershell -File C:\\Tools\\scripts\\rdx_bat_launcher.ps1 version'])('rejects native command bypass %s', command => {
    expect(matchShellFileToolBypass(command, 'pwsh', [])).toContain('RDX_VIA_COMMAND_DENIED');
  });
  it.each(['echo "rg x; cat f"', 'git log --grep=hello', 'git show file', 'dir',
    'pnpm run check:contracts', 'echo hi > file', 'node scripts/check-tools.mjs'])('preserves %s', command => {
    expect(matchShellFileToolBypass(command, 'pwsh', tools)).toBeNull();
  });
  it('does not require an unavailable dedicated tool', () => {
    expect(matchShellFileToolBypass('rg x', 'pwsh', ['read_file'])).toBeNull();
  });
});

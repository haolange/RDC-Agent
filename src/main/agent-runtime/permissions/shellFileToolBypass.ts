import type { ShellKind } from '../../runtime/ShellResolver';

const FILE_COMMANDS: Record<string, string> = {
  cat: 'read_file', type: 'read_file', 'get-content': 'read_file', gc: 'read_file',
  head: 'read_file', tail: 'read_file', more: 'read_file', less: 'read_file',
  rg: 'grep', ripgrep: 'grep', grep: 'grep', findstr: 'grep', 'select-string': 'grep', sls: 'grep',
  find: 'glob', sed: 'edit_file', awk: 'edit_file',
  'set-content': 'write_file', sc: 'write_file', 'add-content': 'write_file',
  'out-file': 'write_file', 'clear-content': 'write_file', 'tee-object': 'write_file',
};

interface Token { value: string; quoted: boolean; separator?: boolean }

/** Preserve quoted arguments: an echoed command name is not an invocation. */
function tokenize(command: string, powershell: boolean, cmd: boolean): Token[] {
  const tokens: Token[] = [];
  let value = '', quote = '', quoted = false;
  const flush = () => { if (value || quoted) tokens.push({ value, quoted }); value = ''; quoted = false; };
  for (let index = 0; index < command.length; index++) {
    const ch = command[index];
    if ((powershell && ch === '`' && quote !== "'") || (!powershell && !cmd && ch === '\\' && quote !== "'") || (cmd && ch === '^')) {
      if (index + 1 < command.length) value += command[++index];
      continue;
    }
    if (quote) {
      if (ch === quote) {
        if (powershell && command[index + 1] === quote) { value += ch; index++; }
        else quote = '';
      } else value += ch;
    } else if (ch === '"' || ch === "'") { quote = ch; quoted = true; }
    else if (';|&\n(){}'.includes(ch)) { flush(); tokens.push({ value: ch, quoted: false, separator: true }); }
    else if (/\s/.test(ch)) flush();
    else value += ch;
  }
  flush();
  return tokens;
}

export function matchShellFileToolBypass(
  command: string, shellKind: ShellKind | 'cmd', effectiveToolNames: readonly string[], depth = 0,
): string | null {
  if (depth > 8) return 'SHELL_FILE_TOOL_BYPASS: nested command depth cannot be verified.';
  const powershell = shellKind === 'pwsh' || shellKind === 'windows-powershell';
  const tokens = tokenize(command, powershell, shellKind === 'cmd');
  let start = 0, invokeQuoted = !powershell;
  for (let end = 0; end <= tokens.length; end++) {
    if (end < tokens.length && !tokens[end].separator) continue;
    const segment = tokens.slice(start, end);
    if (segment.length) {
      let first = 0;
      while (segment[first] && (/^[A-Za-z_][\w]*=/.test(segment[first].value)
        || ['call', 'command', 'exec', 'sudo', 'env', '.'].includes(segment[first].value.toLowerCase()))) first++;
      const head = segment[first];
      if (head && (!head.quoted || invokeQuoted || !powershell)) {
        const name = head.value.split(/[/\\]/).pop()!.replace(/\.(exe|cmd|bat)$/i, '').toLowerCase();
        const args = segment.slice(first + 1).map(token => token.value);
        if (name === 'rdx' || ((name === 'py' || /^python(?:\d+(?:\.\d+)*)?$/.test(name))
          && (args.some(arg => /(?:^|[/\\])run_cli\.py$/i.test(arg))
            || args.some((arg, index) => arg === '-m' && args[index + 1] === 'rdx.cli')))
          || (['pwsh', 'powershell'].includes(name) && args.some(arg => /(?:^|[/\\])rdx_bat_launcher\.ps1$/i.test(arg)))) {
          return 'RDX_VIA_COMMAND_DENIED: use shell.rdx with the frozen installation and owning lease.';
        }
        const target = FILE_COMMANDS[name];
        if (target && effectiveToolNames.includes(target)) return `SHELL_FILE_TOOL_BYPASS: use ${target} instead of ${name}.`;
        if (['pwsh', 'powershell', 'cmd', 'sh', 'bash', 'zsh'].includes(name)) {
          const flag = args.findIndex(arg => /^(?:-c|-command|\/c|\/k|-lc)$/i.test(arg));
          if (flag >= 0) {
            const nested = matchShellFileToolBypass(args.slice(flag + 1).join(' '),
              name === 'powershell' || name === 'pwsh' ? 'pwsh' : name === 'cmd' ? 'cmd' : 'bash', effectiveToolNames, depth + 1);
            if (nested) return nested;
          }
        }
      }
    }
    invokeQuoted = tokens[end]?.value === '&';
    start = end + 1;
  }
  return null;
}

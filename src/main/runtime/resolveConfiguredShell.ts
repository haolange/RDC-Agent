import { settingsService } from '../settings/SettingsService';
import {
  formatShellDialect,
  formatShellInterpreterLabel,
  shellResolver,
  type ResolvedShell,
} from './ShellResolver';

export function resolveConfiguredShell(): ResolvedShell {
  return shellResolver.resolve(settingsService.getAll().tooling?.shell?.executable ?? '');
}

export function describeResolvedShell(shell: ResolvedShell): string {
  const interpreter = formatShellInterpreterLabel(shell.kind);
  const dialect = formatShellDialect(shell.kind);
  const posixWarning = dialect === 'PowerShell'
    ? ' POSIX utilities such as head, grep, and && chaining are not available.'
    : '';
  return (
    `Run a command in the project directory via ${interpreter}. `
    + `Host OS: ${process.platform}. Use ${dialect} syntax only;`
    + posixWarning
    + ' Working directory persists across calls in this session.'
  );
}

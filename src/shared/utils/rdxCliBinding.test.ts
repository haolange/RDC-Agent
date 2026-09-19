import { expect, it } from 'vitest';
import { assertRdxCliBinding } from './rdxCliBinding';
const cli = { enabled: true, command: 'C:\\Tools space\\binaries\\windows\\x64\\python\\python.exe',
  argsPrefix: ['C:\\Tools space\\cli\\run_cli.py'], workingDirectory: '', env: {}, timeoutMs: 30000 };
it('accepts one same-installation entry with spaces and relative entry', () => {
  expect(() => assertRdxCliBinding(cli)).not.toThrow();
  expect(() => assertRdxCliBinding({ ...cli, argsPrefix: ['cli/run_cli.py'] })).not.toThrow();
});
it.each(['rdx', 'C:\\Tools\\rdx.exe', 'C:\\Tools\\bin\\rdx.cmd', 'python.exe', 'C:\\Python\\python.exe'])('rejects %s', command => {
  expect(() => assertRdxCliBinding({ ...cli, command })).toThrow('RDX_BINDING_INVALID');
});
it.each(['C:\\Tools\\rdx.bat', 'rdx.bat'])('rejects bat with a stable token', command => {
  expect(() => assertRdxCliBinding({ ...cli, command })).toThrow('RDX_BAT_REJECTED');
});
it('rejects redirection, missing prefix and another installation', () => {
  for (const patch of [{ argsPrefix: [] }, { argsPrefix: ['C:\\other\\cli\\run_cli.py'] },
    { env: { RDX_TOOLS_ROOT: 'C:\\other' } }, { argsPrefix: ['-File', 'C:\\Tools\\scripts\\rdx_bat_launcher.ps1'] }]) {
    expect(() => assertRdxCliBinding({ ...cli, ...patch })).toThrow();
  }
});

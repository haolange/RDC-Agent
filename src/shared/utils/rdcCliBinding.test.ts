import { describe, expect, it } from 'vitest';
import { assertRdcCliBinding } from './rdcCliBinding';
const cli = { enabled: true, command: 'C:\\Tools space\\binaries\\windows\\x64\\python\\python.exe',
  argsPrefix: ['C:\\Tools space\\cli\\run_cli.py'], workingDirectory: '', env: {}, timeoutMs: 30000 };
it('accepts one same-installation entry with spaces and relative entry', () => {
  expect(() => assertRdcCliBinding(cli)).not.toThrow();
  expect(() => assertRdcCliBinding({ ...cli, argsPrefix: ['cli/run_cli.py'] })).not.toThrow();
});
it.each(['rdc', 'C:\\Tools\\rdc-tool.exe', 'C:\\Tools\\bin\\rdc-tool.cmd', 'python.exe', 'C:\\Python\\python.exe'])('rejects %s', command => {
  expect(() => assertRdcCliBinding({ ...cli, command })).toThrow('RDC_BINDING_INVALID');
});
it.each(['C:\\Tools\\rdc.bat', 'rdc.bat'])('rejects bat with a stable token', command => {
  expect(() => assertRdcCliBinding({ ...cli, command })).toThrow('RDC_BAT_REJECTED');
});
it('rejects redirection, missing prefix and another installation', () => {
  for (const patch of [{ argsPrefix: [] }, { argsPrefix: ['C:\\other\\cli\\run_cli.py'] },
    { env: { RDC_TOOL_ROOT: 'C:\\other' } }, { argsPrefix: ['-File', 'C:\\Tools\\scripts\\rdc_bat_launcher.ps1'] }]) {
    expect(() => assertRdcCliBinding({ ...cli, ...patch })).toThrow();
  }
});

describe('retired identity is rejected', () => {
  const binding = { enabled: true, command: 'C:/Tools/rdc-tool/binaries/windows/x64/python/python.exe', argsPrefix: ['C:/Tools/rdc-tool/cli/run_cli.py'], workingDirectory: '', env: {}, timeoutMs: 30000 };
  it('rejects an old install even with a paired Python and CLI', () => {
    expect(() => assertRdcCliBinding({ ...binding, command: binding.command.replace('rdc-tool', 'rdx-tools'), argsPrefix: [binding.argsPrefix[0]!.replace('rdc-tool', 'rdx-tools')] })).toThrow('retired installation layout');
  });
  it('rejects the old environment even when the new one is supplied', () => {
    expect(() => assertRdcCliBinding({ ...binding, env: { RDX_INTERMEDIATE_ROOT: '', RDC_TOOL_INTERMEDIATE_ROOT: 'C:/tmp' } })).toThrow('retired environment');
  });
});

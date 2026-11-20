import { describe, expect, it } from 'vitest';
import { RDC_HOST_LAYOUTS } from '../platform/rdcLayout';
import { assertRdcCliBinding } from './rdcCliBinding';

const windows = RDC_HOST_LAYOUTS['windows-x64'];
const linux = RDC_HOST_LAYOUTS['linux-x64'];
const cli = { enabled: true, command: 'C:\\Tools space\\binaries\\windows\\x64\\python\\python.exe',
  argsPrefix: ['C:\\Tools space\\cli\\run_cli.py'], workingDirectory: '', env: {}, timeoutMs: 30000 };
it('accepts one same-installation entry with spaces and relative entry', () => {
  expect(assertRdcCliBinding(cli, windows)).toBe('C:/Tools space');
  expect(() => assertRdcCliBinding({ ...cli, argsPrefix: ['cli/run_cli.py'] }, windows)).not.toThrow();
  expect(() => assertRdcCliBinding({ ...cli, command: cli.command.toUpperCase() }, windows)).not.toThrow();
});
it.each(['rdc', 'C:\\Tools\\rdc-tool.exe', 'C:\\Tools\\bin\\rdc-tool.cmd', 'python.exe', 'C:\\Python\\python.exe'])('rejects %s', command => {
  expect(() => assertRdcCliBinding({ ...cli, command }, windows)).toThrow('RDC_BINDING_INVALID');
});
it.each(['C:\\Tools\\rdc.bat', 'rdc.bat'])('rejects bat with a stable token', command => {
  expect(() => assertRdcCliBinding({ ...cli, command }, windows)).toThrow('RDC_BAT_REJECTED');
});
it('rejects redirection, missing prefix and another installation', () => {
  for (const patch of [{ argsPrefix: [] }, { argsPrefix: ['C:\\other\\cli\\run_cli.py'] },
    { env: { PYTHONPATH: 'C:\\other' } }, { argsPrefix: ['-File', 'C:\\Tools\\scripts\\rdc_bat_launcher.ps1'] }]) {
    expect(() => assertRdcCliBinding({ ...cli, ...patch }, windows)).toThrow();
  }
});

describe('Linux host layout', () => {
  const binding = { ...cli, command: '/opt/rdc-tool/binaries/linux/x64/python/bin/python3.14', argsPrefix: ['/opt/rdc-tool/cli/run_cli.py'] };
  it('derives the root from the Linux layout suffix and compares case-sensitively', () => {
    expect(assertRdcCliBinding(binding, linux)).toBe('/opt/rdc-tool');
    expect(() => assertRdcCliBinding({ ...binding, argsPrefix: ['/opt/RDC-tool/cli/run_cli.py'] }, linux)).toThrow('same installation');
  });
  it('rejects the other host layout', () => {
    expect(() => assertRdcCliBinding(cli, linux)).toThrow('binaries/linux/x64/python/bin/python3.14');
    expect(() => assertRdcCliBinding(binding, windows)).toThrow('binaries/windows/x64/python/python.exe');
  });
});

describe('retired identity is rejected', () => {
  const binding = { enabled: true, command: 'C:/Tools/rdc-tool/binaries/windows/x64/python/python.exe', argsPrefix: ['C:/Tools/rdc-tool/cli/run_cli.py'], workingDirectory: '', env: {}, timeoutMs: 30000 };
  it('rejects an old install even with a paired Python and CLI', () => {
    expect(() => assertRdcCliBinding({ ...binding, command: binding.command.replace('rdc-tool', 'rdx-tools'), argsPrefix: [binding.argsPrefix[0]!.replace('rdc-tool', 'rdx-tools')] }, windows)).toThrow('retired installation layout');
  });
  it('rejects the old environment even when the new one is supplied', () => {
    expect(() => assertRdcCliBinding({ ...binding, env: { RDX_INTERMEDIATE_ROOT: '', RDC_TOOL_INTERMEDIATE_ROOT: 'C:/tmp' } }, windows)).toThrow('retired environment');
  });
});

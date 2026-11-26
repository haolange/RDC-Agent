import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeHost } from './host';
import {
  RDC_HOST_LAYOUTS,
  rdcDefaultInstallationRoots,
  rdcHostLayout,
  rdcInstallationFiles,
  rdcRootFromPython,
} from './rdcLayout';

const windows = RDC_HOST_LAYOUTS['windows-x64'];
const linux = RDC_HOST_LAYOUTS['linux-x64'];

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('RDC-Tool host layouts', () => {
  it('selects the layout by host target and refuses hosts RDC-Tool does not ship', () => {
    expect(rdcHostLayout(describeHost('win32', 'x64'))).toBe(windows);
    expect(rdcHostLayout(describeHost('linux', 'x64'))).toBe(linux);
    expect(() => rdcHostLayout(describeHost('linux', 'arm64'))).toThrow(/RDC_HOST_UNSUPPORTED.*linux-arm64/);
  });

  it('derives the root by removing the layout suffix, folding case only on Windows', () => {
    expect(rdcRootFromPython('C:\\Tools\\RDC\\Binaries\\Windows\\x64\\Python\\Python.exe', windows)).toBe(
      'C:/Tools/RDC',
    );
    expect(rdcRootFromPython('D:\\binaries\\windows\\x64\\python\\python.exe', windows)).toBe('D:/');
    expect(rdcRootFromPython('/opt/rdc/binaries/linux/x64/python/bin/python3.14', linux)).toBe('/opt/rdc');
    expect(rdcRootFromPython('/opt/rdc/binaries/linux/x64/python/bin/python3', linux)).toBeNull();
    expect(rdcRootFromPython('/opt/rdc/Binaries/linux/x64/python/bin/python3.14', linux)).toBeNull();
    expect(rdcRootFromPython('relative/binaries/linux/x64/python/bin/python3.14', linux)).toBeNull();
  });

  it('places the bundled Python, native library and CLI entry per layout', () => {
    expect(rdcInstallationFiles('/opt/rdc', linux)).toEqual({
      runtimeDir: '/opt/rdc/binaries/linux/x64',
      python: '/opt/rdc/binaries/linux/x64/python/bin/python3.14',
      nativeLibrary: '/opt/rdc/binaries/linux/x64/lib/librenderdoc.so',
      bindingModule: '/opt/rdc/binaries/linux/x64/pymodules/renderdoc.so',
      entry: '/opt/rdc/cli/run_cli.py',
    });
    expect(rdcInstallationFiles('C:\\Tools', windows).python).toBe(
      'C:\\Tools\\binaries\\windows\\x64\\python\\python.exe',
    );
  });

  it('only probes the installer default on Windows', () => {
    vi.stubEnv('LOCALAPPDATA', 'C:\\Users\\qa\\AppData\\Local');
    expect(rdcDefaultInstallationRoots(describeHost('win32', 'x64'))).toEqual([
      'C:\\Users\\qa\\AppData\\Local\\Programs\\rdc-tool',
    ]);
    expect(rdcDefaultInstallationRoots(describeHost('linux', 'x64'))).toEqual([]);
  });
});

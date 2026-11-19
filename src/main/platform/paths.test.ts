import { describe, expect, it } from 'vitest';
import { describeHost } from './host';
import {
  commandFileNames,
  defaultAppDataDir,
  directoryLinkType,
  expandHomePath,
  pathComparisonKey,
  samePath,
  stripLongPathPrefix,
} from './paths';

const windows = describeHost('win32', 'x64');
const linux = describeHost('linux', 'x64');

describe('host targets', () => {
  it('names targets in the RDC-Tool layout vocabulary', () => {
    expect(windows.target).toBe('windows-x64');
    expect(linux.target).toBe('linux-x64');
    expect(describeHost('darwin', 'arm64')).toMatchObject({ target: 'darwin-arm64', isMac: true, isWindows: false });
  });
});

describe('path comparison', () => {
  it('folds case and Unicode composition only on Windows', () => {
    const decomposed = 'C:\\Proj\\Cafe\u0301';
    expect(pathComparisonKey(decomposed, windows)).toBe('c:\\proj\\caf\u00e9');
    expect(pathComparisonKey('/Proj/Cafe', linux)).toBe('/Proj/Cafe');
    expect(samePath('C:\\Tools\\RDC', 'c:\\tools\\rdc\\', windows)).toBe(true);
    expect(samePath('/tools/RDC', '/tools/rdc', linux)).toBe(false);
  });
});

describe('home expansion', () => {
  it('expands POSIX forms everywhere and Windows forms only on Windows', () => {
    expect(expandHomePath(' ~ ', linux, '/home/qa')).toBe('/home/qa');
    expect(expandHomePath('~/notes', linux, '/home/qa')).toBe('/home/qa/notes');
    expect(expandHomePath('%USERPROFILE%/notes', linux, '/home/qa')).toBe('%USERPROFILE%/notes');
    expect(expandHomePath('~\\notes', windows, 'C:\\Users\\qa')).toBe('C:\\Users\\qa\\notes');
    expect(expandHomePath('%userprofile%\\notes', windows, 'C:\\Users\\qa')).toBe('C:\\Users\\qa\\notes');
  });
});

describe('host directories and names', () => {
  it('strips long-path prefixes only on Windows', () => {
    expect(stripLongPathPrefix('\\\\?\\C:\\Tools', windows)).toBe('C:\\Tools');
    expect(stripLongPathPrefix('\\\\?\\UNC\\server\\share', windows)).toBe('\\\\server\\share');
    expect(stripLongPathPrefix('\\\\?\\C:\\Tools', linux)).toBe('\\\\?\\C:\\Tools');
  });

  it('chooses the per-user application data root and directory link type per host', () => {
    expect(defaultAppDataDir(windows, 'C:\\Users\\qa')).toBe('C:\\Users\\qa\\AppData\\Roaming');
    expect(defaultAppDataDir(linux, '/home/qa')).toBe('/home/qa/.config');
    expect(directoryLinkType(windows)).toBe('junction');
    expect(directoryLinkType(linux)).toBe('dir');
  });

  it('applies PATHEXT only to bare Windows command names', () => {
    expect(commandFileNames('tool', windows, '.EXE;.CMD')).toEqual(['tool', 'tool.EXE', 'tool.CMD']);
    expect(commandFileNames('tool.cmd', windows, '.EXE')).toEqual(['tool.cmd']);
    expect(commandFileNames('tool', linux, '.EXE')).toEqual(['tool']);
  });
});

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseYaml, readYaml, stringifyYaml, writeYaml } from './yaml';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('yaml utils', () => {
  it('parseYaml and stringifyYaml round-trip', () => {
    expect(parseYaml('a: 1')).toEqual({ a: 1 });
    expect(parseYaml('[\n')).toBeNull();
    expect(stringifyYaml({ a: 1 })).toMatch(/a:/);
  });

  it('readYaml returns null for missing or invalid files', () => {
    expect(readYaml(path.join(os.tmpdir(), 'missing-rdc-yaml.yml'))).toBeNull();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-yaml-'));
    tempDirs.push(dir);
    const bad = path.join(dir, 'bad.yml');
    fs.writeFileSync(bad, ':\n:\n', 'utf-8');
    expect(readYaml(bad)).toBeNull();
  });

  it('writeYaml and readYaml persist data', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-yaml-'));
    tempDirs.push(dir);
    const nested = path.join(dir, 'nested', 'file.yml');
    expect(writeYaml(nested, { hello: 'world' })).toBe(true);
    expect(readYaml<{ hello: string }>(nested)).toEqual({ hello: 'world' });
  });
});

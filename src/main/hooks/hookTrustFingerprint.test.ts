import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import type { HookDefinition } from '@shared/types/rdcRuntime';
import {
  computeHookTrustFingerprint,
  resolveExecutableIdentity,
} from './hookTrustFingerprint';

const roots: string[] = [];
const makeRoot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-hook-fp-unit-'));
  roots.push(root);
  return root;
};
afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

const definition = (overrides: Partial<HookDefinition> = {}): HookDefinition => ({
  id: 'audit',
  enabled: true,
  event: 'tool.before-call',
  command: process.execPath,
  args: [],
  timeoutMs: 1000,
  failurePolicy: 'block',
  ...overrides,
});

describe('hookTrustFingerprint', () => {
  it('changes when script bytes, realpath, scope, or executable identity change', () => {
    const root = makeRoot();
    const sourcePath = path.join(root, 'audit.hook.yml');
    const scriptA = path.join(root, 'a.mjs');
    const scriptB = path.join(root, 'b.mjs');
    fs.writeFileSync(sourcePath, 'id: audit\n');
    fs.writeFileSync(scriptA, 'process.exit(0)\n');
    fs.writeFileSync(scriptB, 'process.exit(0)\n');
    const base = computeHookTrustFingerprint({
      definition: definition({ args: [scriptA] }),
      scope: 'project',
      sourcePath,
      projectRoot: root,
    });
    const bytesChanged = computeHookTrustFingerprint({
      definition: definition({ args: [scriptA] }),
      scope: 'project',
      sourcePath,
      projectRoot: root,
    });
    fs.writeFileSync(scriptA, 'process.exit(1)\n');
    const afterBytes = computeHookTrustFingerprint({
      definition: definition({ args: [scriptA] }),
      scope: 'project',
      sourcePath,
      projectRoot: root,
    });
    const otherPath = computeHookTrustFingerprint({
      definition: definition({ args: [scriptB] }),
      scope: 'project',
      sourcePath,
      projectRoot: root,
    });
    const otherScope = computeHookTrustFingerprint({
      definition: definition({ args: [scriptB] }),
      scope: 'user',
      sourcePath,
      projectRoot: root,
    });
    expect(bytesChanged).toBe(base);
    expect(afterBytes).not.toBe(base);
    expect(otherPath).not.toBe(base);
    expect(otherScope).not.toBe(otherPath);
    expect(resolveExecutableIdentity(process.execPath).identity).toEqual(
      expect.objectContaining({ realpath: expect.any(String), sha256: expect.any(String) }),
    );
  });

  it('includes an extensionless relative script and detects same-size same-mtime replacement', () => {
    const root = makeRoot();
    const sourcePath = path.join(root, 'audit.hook.yml');
    const script = path.join(root, 'run');
    fs.writeFileSync(sourcePath, 'id: audit\n');
    fs.writeFileSync(script, 'process.exit(0)\n');
    const input = {
      definition: definition({ args: ['run'] }),
      scope: 'project' as const,
      sourcePath,
      projectRoot: root,
    };
    const base = computeHookTrustFingerprint(input);
    const stat = fs.statSync(script);
    fs.writeFileSync(script, 'process.exit(1)\n');
    fs.utimesSync(script, stat.atime, stat.mtime);
    expect(fs.statSync(script).size).toBe(stat.size);
    expect(computeHookTrustFingerprint(input)).not.toBe(base);
  });
});

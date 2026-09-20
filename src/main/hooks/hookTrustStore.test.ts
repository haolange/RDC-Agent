import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CURRENT_HOOK_TRUST_SCHEMA_VERSION,
  readHookTrustStore,
  writeHookTrustStore,
} from './hookTrustStore';

const roots: string[] = [];
const makeRoot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-hook-trust-store-'));
  roots.push(root);
  return root;
};
afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

describe('hookTrustStore', () => {
  it('invalidates YAML-only v1 records on first load and rewrites schemaVersion 2', () => {
    const filePath = path.join(makeRoot(), 'hook-trust.json');
    fs.writeFileSync(filePath, JSON.stringify({
      'd:\\project::check': { sourceHash: 'yaml-only', trustedAt: '2026-01-01T00:00:00.000Z' },
    }));
    const store = readHookTrustStore(filePath);
    expect(store).toEqual({ schemaVersion: CURRENT_HOOK_TRUST_SCHEMA_VERSION, records: {} });
    expect(JSON.parse(fs.readFileSync(filePath, 'utf8'))).toEqual({
      schemaVersion: CURRENT_HOOK_TRUST_SCHEMA_VERSION,
      records: {},
    });
    expect(JSON.stringify(store)).not.toContain('sourceHash');
    expect(JSON.stringify(store)).not.toContain('yaml-only');
  });

  it('fail-closes unknown higher schemaVersion without rewriting', () => {
    const filePath = path.join(makeRoot(), 'hook-trust.json');
    const future = { schemaVersion: '99', records: { keep: true } };
    fs.writeFileSync(filePath, JSON.stringify(future));
    expect(() => readHookTrustStore(filePath)).toThrow(/STORAGE_SCHEMA_UNSUPPORTED/);
    expect(JSON.parse(fs.readFileSync(filePath, 'utf8'))).toEqual(future);
  });

  it('reads current schemaVersion 2 records', () => {
    const filePath = path.join(makeRoot(), 'hook-trust.json');
    const store = {
      schemaVersion: CURRENT_HOOK_TRUST_SCHEMA_VERSION,
      records: {
        'project::d:\\app::audit': {
          trustFingerprint: 'fp-1',
          trustedAt: '2026-01-01T00:00:00.000Z',
          scope: 'project' as const,
          hookId: 'audit',
          ownerRoot: 'D:\\app',
        },
      },
    };
    writeHookTrustStore(filePath, store);
    expect(readHookTrustStore(filePath)).toEqual(store);
  });
});

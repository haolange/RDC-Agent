import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TrustStore } from './TrustStore';

let root: string;
let filePath: string;
let store: TrustStore;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-trust-'));
  filePath = path.join(root, 'trust.json');
  store = new TrustStore(() => filePath);
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('TrustStore', () => {
  it('trusts one fingerprint for one resource in one owner directory', () => {
    store.trust('project', '/work/Game', 'lint', 'sha-a');
    expect(store.isTrusted('project', '/work/game', 'lint', 'sha-a')).toBe(true);
    expect(store.isTrusted('project', '/work/Game', 'lint', 'sha-b')).toBe(false);
    expect(store.isTrusted('user', '/work/Game', 'lint', 'sha-a')).toBe(false);
    store.revoke((record) => record.resourceId === 'lint');
    expect(store.isTrusted('project', '/work/Game', 'lint', 'sha-a')).toBe(false);
  });

  it('reports a damaged file on read and lets a repeated decision replace it', () => {
    fs.writeFileSync(filePath, '{"schemaVersion":3,"records":');
    expect(() => store.isTrusted('project', '/work', 'lint', 'sha-a')).toThrow(expect.objectContaining({ code: 'STORAGE_CORRUPT' }));
    store.trust('project', '/work', 'lint', 'sha-a');
    expect(store.isTrusted('project', '/work', 'lint', 'sha-a')).toBe(true);
    expect(fs.readdirSync(root).some((name) => name.startsWith('trust.json.corrupt-'))).toBe(true);
  });

  it('honors no decision from another trust version and refuses a newer one', () => {
    fs.writeFileSync(filePath, JSON.stringify({ schemaVersion: '2', records: { any: { trustFingerprint: 'sha-a' } } }));
    expect(store.isTrusted('project', '/work', 'any', 'sha-a')).toBe(false);
    fs.writeFileSync(filePath, JSON.stringify({ schemaVersion: 4, records: {} }));
    expect(() => store.get('project', '/work', 'any')).toThrow(expect.objectContaining({ code: 'STORAGE_SCHEMA_UNSUPPORTED' }));
  });
});

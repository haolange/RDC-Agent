import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { SessionArtifactError } from '@shared/types/sessionArtifact';
import { SessionArtifactResolver } from './SessionArtifactResolver';
import { SESSION_ARTIFACT_QUOTA_FILENAME, resetSessionArtifactQuotaLedger } from './SessionArtifactQuota';
import { StorageIo } from './StorageIo';

const roots: string[] = [];

afterEach(() => {
  resetSessionArtifactQuotaLedger();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function makeSession(name = 'session-a'): { sessionId: string; sessionPath: string } {
  const sessionPath = fs.mkdtempSync(path.join(os.tmpdir(), `rdx-artifact-${name}-`));
  roots.push(sessionPath);
  fs.writeFileSync(path.join(sessionPath, 'session.json'), '{}', 'utf8');
  return { sessionId: name, sessionPath };
}

function createResolver(sessions: Record<string, string>, limits?: {
  maxFileBytes?: number;
  maxSessionBytes?: number;
  maxToolOutputFiles?: number;
}): SessionArtifactResolver {
  return new SessionArtifactResolver({
    resolveSessionPath: (sessionId) => sessions[sessionId] ?? null,
    io: new StorageIo(),
    ...limits,
  });
}

describe('SessionArtifactResolver', () => {
  it('writes atomically, hashes, and reads back a JSON artifact', () => {
    const a = makeSession('own');
    const resolver = createResolver({ [a.sessionId]: a.sessionPath });
    const written = resolver.write(
      a.sessionId,
      'session://tool-outputs/call-1.json',
      Buffer.from('{"ok":true}', 'utf8'),
      { mimeType: 'application/json' },
    );
    expect(written.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(written.bytes).toBe(11);
    const leftovers = fs.readdirSync(path.join(a.sessionPath, 'session-artifacts', 'tool-outputs'))
      .filter((name) => name.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
    const read = resolver.read(a.sessionId, 'session://tool-outputs/call-1.json', { expectedHash: written.hash });
    expect(read.text).toBe('{"ok":true}');
    expect(read.hash).toBe(written.hash);
  });

  it('rejects .., absolute paths, and unknown categories', () => {
    const a = makeSession();
    const resolver = createResolver({ [a.sessionId]: a.sessionPath });
    expect(() => resolver.resolve(a.sessionId, 'session://tool-outputs/../escape.json'))
      .toThrow(SessionArtifactError);
    expect(() => resolver.resolve(a.sessionId, 'session://tool-outputs/../escape.json'))
      .toThrow(/ARTIFACT_PATH_ESCAPE/);
    expect(() => resolver.resolve(a.sessionId, 'session://tool-outputs/C:/Windows/x.txt'))
      .toThrow(/ARTIFACT_PATH_ESCAPE/);
    expect(() => resolver.resolve(a.sessionId, 'session://secrets/x.txt'))
      .toThrow(/ARTIFACT_CATEGORY_UNKNOWN/);
    expect(() => resolver.resolve(a.sessionId, 'file://tool-outputs/x.txt'))
      .toThrow(/ARTIFACT_URI_INVALID/);
  });

  it('denies missing session and cannot read another session root', () => {
    const a = makeSession('sess-a');
    const b = makeSession('sess-b');
    const resolver = createResolver({ [a.sessionId]: a.sessionPath, [b.sessionId]: b.sessionPath });
    resolver.write(a.sessionId, 'session://tool-outputs/secret.json', '{"from":"a"}');
    expect(() => resolver.read(null, 'session://tool-outputs/secret.json'))
      .toThrow(/ARTIFACT_SESSION_DENIED/);
    expect(() => resolver.read('missing', 'session://tool-outputs/secret.json'))
      .toThrow(/ARTIFACT_SESSION_DENIED/);
    expect(() => resolver.read(b.sessionId, 'session://tool-outputs/secret.json'))
      .toThrow(/ARTIFACT_NOT_FOUND/);
    expect(() => resolver.read(b.sessionId, 'session://tool-outputs/../sess-a/session-artifacts/tool-outputs/secret.json'))
      .toThrow(/ARTIFACT_PATH_ESCAPE/);
  });

  it('rejects a hardlink of session B content planted in session A', () => {
    const a = makeSession('hard-a');
    const b = makeSession('hard-b');
    const resolver = createResolver({ [a.sessionId]: a.sessionPath, [b.sessionId]: b.sessionPath });
    resolver.write(b.sessionId, 'session://tool-outputs/secret.json', '{"from":"b"}');
    const source = path.join(b.sessionPath, 'session-artifacts', 'tool-outputs', 'secret.json');
    const categoryRoot = path.join(a.sessionPath, 'session-artifacts', 'tool-outputs');
    fs.mkdirSync(categoryRoot, { recursive: true });
    const planted = path.join(categoryRoot, 'planted.json');
    fs.linkSync(source, planted);
    expect(fs.lstatSync(planted).nlink).toBeGreaterThan(1);
    expect(() => resolver.read(a.sessionId, 'session://tool-outputs/planted.json'))
      .toThrow(/ARTIFACT_HARDLINK_REJECTED/);
    expect(() => resolver.write(a.sessionId, 'session://tool-outputs/planted.json', '{"overwrite":true}'))
      .toThrow(/ARTIFACT_HARDLINK_REJECTED/);
  });

  it('rejects symlink targets when the platform can create them', () => {
    const a = makeSession('link-a');
    const b = makeSession('link-b');
    const resolver = createResolver({ [a.sessionId]: a.sessionPath, [b.sessionId]: b.sessionPath });
    const outside = path.join(b.sessionPath, 'outside.txt');
    fs.writeFileSync(outside, 'stolen', 'utf8');
    const categoryRoot = path.join(a.sessionPath, 'session-artifacts', 'tool-outputs');
    fs.mkdirSync(categoryRoot, { recursive: true });
    const link = path.join(categoryRoot, 'linked.json');
    try {
      fs.symlinkSync(outside, link);
    } catch {
      return;
    }
    expect(() => resolver.read(a.sessionId, 'session://tool-outputs/linked.json'))
      .toThrow(/ARTIFACT_SYMLINK_REJECTED/);
  });

  it('enforces file size, session quota, and tool-outputs file count', () => {
    const a = makeSession('quota');
    const resolver = createResolver({ [a.sessionId]: a.sessionPath }, {
      maxFileBytes: 32,
      maxSessionBytes: 40,
      maxToolOutputFiles: 2,
    });
    expect(() => resolver.write(a.sessionId, 'session://tool-outputs/big.json', 'x'.repeat(40)))
      .toThrow(/ARTIFACT_TOO_LARGE/);
    resolver.write(a.sessionId, 'session://tool-outputs/one.json', '{"a":1}');
    resolver.write(a.sessionId, 'session://tool-outputs/two.json', '{"b":2}');
    expect(() => resolver.write(a.sessionId, 'session://tool-outputs/three.json', '{"c":3}'))
      .toThrow(/ARTIFACT_QUOTA_EXCEEDED/);

    const tight = createResolver({ [a.sessionId]: a.sessionPath }, {
      maxFileBytes: 1024,
      maxSessionBytes: 20,
      maxToolOutputFiles: 16,
    });
    expect(() => tight.write(a.sessionId, 'session://tool-outputs/quota.json', '{"overflow":true}'))
      .toThrow(/ARTIFACT_QUOTA_EXCEEDED/);
  });

  it('rejects SVG, executables, and .rdc', () => {
    const a = makeSession('mime');
    const resolver = createResolver({ [a.sessionId]: a.sessionPath });
    expect(() => resolver.write(a.sessionId, 'session://tool-outputs/x.svg', '<svg></svg>'))
      .toThrow(/ARTIFACT_MIME_DENIED/);
    expect(() => resolver.write(a.sessionId, 'session://tool-outputs/x.exe', Buffer.from([0x4d, 0x5a, 0x00, 0x00])))
      .toThrow(/ARTIFACT_MIME_DENIED/);
    expect(() => resolver.write(a.sessionId, 'session://tool-outputs/cap.rdc', Buffer.from('RDOC\0\0\0x')))
      .toThrow(/ARTIFACT_MIME_DENIED/);
  });

  it('fail-closes on hash mismatch and supports sweepToolOutputs', () => {
    const a = makeSession('hash');
    const resolver = createResolver({ [a.sessionId]: a.sessionPath });
    const written = resolver.write(a.sessionId, 'session://tool-outputs/hashed.json', '{"n":1}');
    expect(() => resolver.read(a.sessionId, 'session://tool-outputs/hashed.json', {
      expectedHash: '0'.repeat(64),
    })).toThrow(/ARTIFACT_HASH_MISMATCH/);
    expect(resolver.read(a.sessionId, written.uri, { expectedHash: written.hash }).text).toContain('"n":1');
    resolver.sweepToolOutputs(a.sessionId);
    expect(() => resolver.read(a.sessionId, written.uri)).toThrow(/ARTIFACT_NOT_FOUND/);
  });

  it('reserves plans and investigation categories without requiring content writers', () => {
    const a = makeSession('reserve');
    const resolver = createResolver({ [a.sessionId]: a.sessionPath });
    const parsed = resolver.parse('session://plans/future.md');
    expect(parsed.category).toBe('plans');
    expect(resolver.parse('session://investigation/world.json').category).toBe('investigation');
    expect(() => resolver.read(a.sessionId, 'session://plans/future.md')).toThrow(/ARTIFACT_NOT_FOUND/);
  });

  it('lets at most one of two concurrent 60% writes commit', async () => {
    for (let round = 0; round < 3; round += 1) {
      resetSessionArtifactQuotaLedger();
      const a = makeSession(`race-${round}`);
      const cap = 200;
      const resolver = createResolver({ [a.sessionId]: a.sessionPath }, {
        maxFileBytes: cap,
        maxSessionBytes: cap,
        maxToolOutputFiles: 16,
      });
      const chunk = jsonPad(Math.floor(cap * 0.6));
      expect(Buffer.byteLength(chunk, 'utf8')).toBeLessThan(cap);
      expect(Buffer.byteLength(chunk, 'utf8') * 2).toBeGreaterThan(cap);

      let nestedError: unknown;
      resolver.write(a.sessionId, 'session://tool-outputs/first.json', chunk, {
        mimeType: 'application/json',
        onAfterReserve: () => {
          try {
            resolver.write(a.sessionId, 'session://tool-outputs/second.json', chunk, {
              mimeType: 'application/json',
            });
          } catch (error) {
            nestedError = error;
          }
        },
      });
      expect(nestedError).toBeInstanceOf(SessionArtifactError);
      expect(String(nestedError)).toMatch(/ARTIFACT_QUOTA_EXCEEDED/);

      const settled = await Promise.allSettled([
        Promise.resolve().then(() => resolver.write(
          a.sessionId,
          'session://tool-outputs/third.json',
          chunk,
          { mimeType: 'application/json' },
        )),
        Promise.resolve().then(() => resolver.write(
          a.sessionId,
          'session://tool-outputs/fourth.json',
          chunk,
          { mimeType: 'application/json' },
        )),
      ]);
      const fulfilled = settled.filter((item) => item.status === 'fulfilled');
      const rejected = settled.filter((item) => item.status === 'rejected');
      expect(fulfilled.length).toBe(0);
      expect(rejected.length).toBe(2);

      const usage = resolver.getQuotaUsage(a.sessionId);
      expect(usage.liveBytes).toBeLessThanOrEqual(cap);
      expect(usage.reservedBytes).toBe(0);
      expect(usage.diskBytes).toBeLessThanOrEqual(cap);
      const files = listCommitted(a.sessionPath);
      expect(files).toHaveLength(1);
      expect(files[0]).toBe('first.json');
    }
  });

  it('reserves only the overwrite delta', () => {
    const a = makeSession('delta');
    const resolver = createResolver({ [a.sessionId]: a.sessionPath }, {
      maxFileBytes: 200,
      maxSessionBytes: 100,
      maxToolOutputFiles: 8,
    });
    const first = jsonPad(70);
    const smaller = jsonPad(40);
    const sibling = jsonPad(50);
    resolver.write(a.sessionId, 'session://tool-outputs/slot.json', first, { mimeType: 'application/json' });
    expect(resolver.getQuotaUsage(a.sessionId).diskBytes).toBe(Buffer.byteLength(first, 'utf8'));
    resolver.write(a.sessionId, 'session://tool-outputs/slot.json', smaller, { mimeType: 'application/json' });
    expect(resolver.getQuotaUsage(a.sessionId).diskBytes).toBe(Buffer.byteLength(smaller, 'utf8'));
    resolver.write(a.sessionId, 'session://tool-outputs/extra.json', sibling, { mimeType: 'application/json' });
    expect(resolver.getQuotaUsage(a.sessionId).diskBytes).toBe(
      Buffer.byteLength(smaller, 'utf8') + Buffer.byteLength(sibling, 'utf8'),
    );
    expect(() => resolver.write(a.sessionId, 'session://tool-outputs/overflow.json', jsonPad(20), {
      mimeType: 'application/json',
    })).toThrow(/ARTIFACT_QUOTA_EXCEEDED/);
  });

  it('releases reservation when the after-reserve hook throws or aborts', () => {
    const a = makeSession('abort');
    const resolver = createResolver({ [a.sessionId]: a.sessionPath }, {
      maxFileBytes: 200,
      maxSessionBytes: 80,
      maxToolOutputFiles: 8,
    });
    const payload = jsonPad(50);
    expect(() => resolver.write(a.sessionId, 'session://tool-outputs/boom.json', payload, {
      mimeType: 'application/json',
      onAfterReserve: () => {
        throw new Error('simulated mid-write failure');
      },
    })).toThrow(/ARTIFACT_WRITE_FAILED|simulated mid-write failure/);
    expect(resolver.getQuotaUsage(a.sessionId).reservedBytes).toBe(0);
    expect(listCommitted(a.sessionPath)).toEqual([]);

    const controller = new AbortController();
    expect(() => resolver.write(a.sessionId, 'session://tool-outputs/aborted.json', payload, {
      mimeType: 'application/json',
      signal: controller.signal,
      onAfterReserve: () => controller.abort(),
    })).toThrow(/ARTIFACT_WRITE_FAILED/);
    expect(resolver.getQuotaUsage(a.sessionId).reservedBytes).toBe(0);
    expect(listCommitted(a.sessionPath)).toEqual([]);
    expect(listTemps(a.sessionPath)).toEqual([]);

    resolver.write(a.sessionId, 'session://tool-outputs/ok.json', payload, { mimeType: 'application/json' });
    expect(resolver.getQuotaUsage(a.sessionId).diskBytes).toBeLessThanOrEqual(80);
  });

  it('reconciles crashed reservations and leftover tmp to disk truth', () => {
    const a = makeSession('crash');
    const resolver = createResolver({ [a.sessionId]: a.sessionPath }, {
      maxFileBytes: 200,
      maxSessionBytes: 120,
      maxToolOutputFiles: 8,
    });
    const committed = jsonPad(30);
    resolver.write(a.sessionId, 'session://tool-outputs/kept.json', committed, { mimeType: 'application/json' });
    const artifactsRoot = path.join(a.sessionPath, 'session-artifacts');
    const toolOutputs = path.join(artifactsRoot, 'tool-outputs');
    fs.writeFileSync(path.join(toolOutputs, 'kept.json.1234.deadbeefabcd.tmp'), '{"partial":true}', 'utf8');
    fs.writeFileSync(path.join(artifactsRoot, SESSION_ARTIFACT_QUOTA_FILENAME), `${JSON.stringify({
      schemaVersion: '1',
      committedBytes: 0,
      committedToolOutputFiles: 0,
      reservations: [{
        id: 'leak-1',
        incomingBytes: 999_999,
        existingBytes: 0,
        deltaBytes: 999_999,
        extraFiles: 1,
      }],
    })}\n`, 'utf8');
    resetSessionArtifactQuotaLedger();
    const recovered = resolver.reconcileUsage(a.sessionId);
    expect(recovered.reservedBytes).toBe(0);
    expect(recovered.diskBytes).toBe(Buffer.byteLength(committed, 'utf8'));
    expect(recovered.liveBytes).toBe(recovered.diskBytes);
    expect(listTemps(a.sessionPath)).toEqual([]);
    expect(listCommitted(a.sessionPath)).toEqual(['kept.json']);
    resolver.write(a.sessionId, 'session://tool-outputs/after-crash.json', jsonPad(40), {
      mimeType: 'application/json',
    });
    expect(resolver.getQuotaUsage(a.sessionId).liveBytes).toBeLessThanOrEqual(120);
  });

  it('new resolver first touch sweeps leftover tmp and stale quota json', () => {
    const a = makeSession('restart');
    const writer = createResolver({ [a.sessionId]: a.sessionPath }, {
      maxFileBytes: 200,
      maxSessionBytes: 120,
      maxToolOutputFiles: 8,
    });
    const committed = jsonPad(30);
    writer.write(a.sessionId, 'session://tool-outputs/kept.json', committed, { mimeType: 'application/json' });
    const artifactsRoot = path.join(a.sessionPath, 'session-artifacts');
    const toolOutputs = path.join(artifactsRoot, 'tool-outputs');
    fs.writeFileSync(path.join(toolOutputs, 'kept.json.9999.leftovertmp.tmp'), '{"partial":true}', 'utf8');
    fs.writeFileSync(path.join(artifactsRoot, SESSION_ARTIFACT_QUOTA_FILENAME), `${JSON.stringify({
      schemaVersion: '1',
      committedBytes: 0,
      committedToolOutputFiles: 0,
      reservations: [{
        id: 'stale-res',
        incomingBytes: 888_888,
        existingBytes: 0,
        deltaBytes: 888_888,
        extraFiles: 1,
      }],
    })}\n`, 'utf8');
    resetSessionArtifactQuotaLedger();
    expect(listTemps(a.sessionPath).length).toBeGreaterThan(0);

    const restarted = createResolver({ [a.sessionId]: a.sessionPath }, {
      maxFileBytes: 200,
      maxSessionBytes: 120,
      maxToolOutputFiles: 8,
    });
    const listed = restarted.list(a.sessionId);
    const usage = restarted.getQuotaUsage(a.sessionId);
    expect(listed).toEqual(['session://tool-outputs/kept.json']);
    expect(listTemps(a.sessionPath)).toEqual([]);
    expect(usage.reservedBytes).toBe(0);
    expect(usage.diskBytes).toBe(Buffer.byteLength(committed, 'utf8'));
    expect(usage.liveBytes).toBe(usage.diskBytes);
    const quota = JSON.parse(
      fs.readFileSync(path.join(artifactsRoot, SESSION_ARTIFACT_QUOTA_FILENAME), 'utf8'),
    ) as { reservations: unknown[]; committedBytes: number };
    expect(quota.reservations).toEqual([]);
    expect(quota.committedBytes).toBe(usage.diskBytes);
  });

  it('rejects a directory junction planted under tool-outputs', () => {
    const a = makeSession('junc-a');
    const b = makeSession('junc-b');
    const resolver = createResolver({ [a.sessionId]: a.sessionPath, [b.sessionId]: b.sessionPath });
    resolver.write(b.sessionId, 'session://tool-outputs/secret.json', '{"from":"b"}');
    const outside = path.join(b.sessionPath, 'session-artifacts', 'tool-outputs');
    const categoryRoot = path.join(a.sessionPath, 'session-artifacts', 'tool-outputs');
    fs.mkdirSync(categoryRoot, { recursive: true });
    const link = path.join(categoryRoot, 'escaped');
    try {
      fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
      return;
    }
    expect(() => resolver.read(a.sessionId, 'session://tool-outputs/escaped/secret.json'))
      .toThrow(/ARTIFACT_SYMLINK_REJECTED|ARTIFACT_PATH_ESCAPE/);
    expect(() => resolver.write(a.sessionId, 'session://tool-outputs/escaped/planted.json', '{"x":1}'))
      .toThrow(/ARTIFACT_SYMLINK_REJECTED|ARTIFACT_PATH_ESCAPE/);
  });
});

function jsonPad(bytes: number): string {
  const prefix = '{"pad":"';
  const suffix = '"}';
  const fill = Math.max(0, bytes - prefix.length - suffix.length);
  return `${prefix}${'p'.repeat(fill)}${suffix}`;
}

function listCommitted(sessionPath: string): string[] {
  const dir = path.join(sessionPath, 'session-artifacts', 'tool-outputs');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => !name.toLowerCase().endsWith('.tmp'))
    .sort();
}

function listTemps(sessionPath: string): string[] {
  const root = path.join(sessionPath, 'session-artifacts');
  if (!fs.existsSync(root)) return [];
  const found: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of fs.readdirSync(current)) {
      const full = path.join(current, entry);
      const stat = fs.lstatSync(full);
      if (stat.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (entry.toLowerCase().endsWith('.tmp')) found.push(entry);
    }
  }
  return found;
}

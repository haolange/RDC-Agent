import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { SessionArtifactError } from '@shared/types/sessionArtifact';
import { SessionArtifactResolver } from './SessionArtifactResolver';
import { StorageIo } from './StorageIo';

const roots: string[] = [];

afterEach(() => {
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
});

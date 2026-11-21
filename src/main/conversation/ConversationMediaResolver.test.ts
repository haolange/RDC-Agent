import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveConversationMedia, type ConversationMediaScope } from './ConversationMediaResolver';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const roots: string[] = [];

function fixture(): { scope: ConversationMediaScope; project: string; outside: string } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-media-'));
  roots.push(base);
  const project = path.join(base, 'project');
  const attachments = path.join(base, 'attachments');
  const artifacts = path.join(base, 'artifacts');
  for (const dir of [project, attachments, artifacts, path.join(project, 'docs')]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(project, 'docs', 'frame.png'), PNG);
  fs.writeFileSync(path.join(project, 'notes.txt'), 'text');
  fs.writeFileSync(path.join(project, 'fake.png'), 'not an image');
  fs.writeFileSync(path.join(attachments, 'a1-shot.png'), PNG);
  fs.writeFileSync(path.join(artifacts, 'out.png'), PNG);
  const outside = path.join(base, 'outside.png');
  fs.writeFileSync(outside, PNG);
  return {
    project,
    outside,
    scope: {
      resolveArtifact: (uri) => {
        if (uri !== 'session://outputs/out.png') throw new Error('ARTIFACT_PATH_ESCAPE');
        return path.join(artifacts, 'out.png');
      },
      projectRoot: project,
      attachmentsRoot: attachments,
      attachments: [{ fileName: 'shot.png', filePath: path.join(attachments, 'a1-shot.png') }],
    },
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('resolveConversationMedia', () => {
  it('resolves project files, attachments by name and session artifacts into sniffed data URLs', () => {
    const { scope } = fixture();
    for (const src of ['docs/frame.png', 'shot.png', 'session://outputs/out.png']) {
      const result = resolveConversationMedia(src, scope);
      expect(result).toMatchObject({ kind: 'image' });
      expect(result.dataUrl?.startsWith('data:image/png;base64,')).toBe(true);
    }
  });

  it('refuses anything outside the three roots, other schemes, and bytes that do not match an allowed type', () => {
    const { scope, project, outside } = fixture();
    fs.symlinkSync(outside, path.join(project, 'link.png'));
    expect(resolveConversationMedia('../outside.png', scope)).toEqual({ dataUrl: null, error: 'MEDIA_SCOPE_DENIED' });
    expect(resolveConversationMedia(outside, scope)).toEqual({ dataUrl: null, error: 'MEDIA_SCOPE_DENIED' });
    expect(resolveConversationMedia('link.png', scope)).toEqual({ dataUrl: null, error: 'MEDIA_SCOPE_DENIED' });
    expect(resolveConversationMedia('file:///etc/passwd', scope)).toEqual({ dataUrl: null, error: 'MEDIA_SCOPE_DENIED' });
    expect(resolveConversationMedia('session://outputs/../../x.png', scope)).toEqual({ dataUrl: null, error: 'MEDIA_SCOPE_DENIED' });
    expect(resolveConversationMedia('notes.txt', scope)).toEqual({ dataUrl: null, error: 'MEDIA_TYPE_DENIED' });
    expect(resolveConversationMedia('fake.png', scope)).toEqual({ dataUrl: null, error: 'MEDIA_TYPE_DENIED' });
    expect(resolveConversationMedia('missing.png', scope)).toEqual({ dataUrl: null, error: 'MEDIA_NOT_FOUND' });
  });
});

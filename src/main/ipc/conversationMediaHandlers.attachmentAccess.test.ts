import { promises as fsPromises, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pruneAttachmentDocumentCopies } from '../conversation/AttachmentDocumentOpen';
import { attachmentStagingService } from '../conversation/AttachmentStagingService';
import { registerConversationMediaHandlers } from './conversationMediaHandlers';
import type { ConversationAccessAttachmentRequest } from '@shared/types/conversation';

const deps = vi.hoisted(() => ({
  root: '', sessionAttachments: vi.fn(), handle: vi.fn(), openPath: vi.fn(), showItemInFolder: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: { handle: deps.handle }, shell: { openPath: deps.openPath, showItemInFolder: deps.showItemInFolder },
}));
vi.mock('../runtime/AppPathService', () => ({
  appPathService: { getAppStatePaths: () => ({ appStateRoot: deps.root, attachmentStagingPath: join(deps.root, 'staging') }) },
}));
vi.mock('../sessions/artifacts/SessionArtifactResolver', () => ({ sessionArtifactResolver: {} }));
vi.mock('../sessions/store/StorageAdapter', () => ({
  storageAdapter: {
    listSessionAttachments: deps.sessionAttachments,
    getSessionAttachmentsDir: () => join(deps.root, 'owned'),
  },
}));

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9X8AAAAASUVORK5CYII=';
const SCOPE = 'project:session';
const SESSION = 'session';
const ATTACHMENT = 'att_1';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function officePackage(extra: Record<string, Uint8Array> = {}) {
  return zipSync({
    '[Content_Types].xml': strToU8(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
      <Override PartName="/word/document.xml" ContentType="${DOCX_MIME}.main+xml"/>
    </Types>`),
    '_rels/.rels': strToU8(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
    </Relationships>`),
    'word/document.xml': strToU8(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body><w:p><w:r><w:t>Fixture</w:t></w:r></w:p></w:body>
    </w:document>`),
    ...extra,
  });
}

function pdfDocument(): Buffer {
  let pdf = '%PDF-1.4\n';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>',
  ];
  const entries = objects.map((object, index) => {
    const offset = String(pdf.length).padStart(10, '0');
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return `${offset} 00000 n `;
  });
  return Buffer.from(`${pdf}xref\n0 4\n0000000000 65535 f \n${entries.join('\n')}\ntrailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${pdf.length}\n%%EOF\n`);
}

describe('conversation:accessAttachment', () => {
  const state = { currentSessionId: SESSION };
  beforeEach(() => {
    vi.resetAllMocks();
    deps.root = mkdtempSync(join(tmpdir(), 'rdc-attachment-access-'));
    state.currentSessionId = SESSION;
    mkdirSync(join(deps.root, 'owned'));
    attachmentStagingService.clearAll();
    deps.openPath.mockResolvedValue('');
    registerConversationMediaHandlers({ state } as never);
  });
  afterEach(() => {
    attachmentStagingService.clearAll();
    rmSync(deps.root, { recursive: true, force: true });
  });

  const invoke = (request: ConversationAccessAttachmentRequest | Record<string, unknown>) => {
    const handler = deps.handle.mock.calls.find(([channel]) => channel === 'conversation:accessAttachment')?.[1];
    return handler({}, request) as Promise<unknown>;
  };
  const stage = async (fileName: string, bytes: string) => {
    const [item] = await attachmentStagingService.stage([{ fileName, bytesBase64: bytes }], SCOPE);
    expect(item.error).toBeUndefined();
    return { scope: 'staging' as const, stagingId: item.stagingId, composerScopeKey: SCOPE };
  };

  it('returns the exact original raster, including when its name matches the thumbnail', async () => {
    const owner = await stage('preview.png', PNG);
    const staged = attachmentStagingService.get(owner.stagingId);
    expect(staged?.bytesPath).not.toBe(staged?.previewPath);
    expect(attachmentStagingService.readPreviewDataUrl(owner.stagingId, SCOPE)).toMatch(/^data:image\/png;base64,/u);
    await expect(invoke({ owner, action: 'preview' })).resolves.toEqual({ kind: 'image', dataUrl: `data:image/png;base64,${PNG}` });
    await expect(invoke({ owner: { ...owner, composerScopeKey: 'different' }, action: 'preview' }))
      .resolves.toEqual({ kind: 'error', code: 'unavailable' });
    attachmentStagingService.release([owner.stagingId]);
    await expect(invoke({ owner, action: 'preview' })).resolves.toEqual({ kind: 'error', code: 'unavailable' });
  });

  it('returns all Markdown from the exact committed record and rejects other sessions and invalid UTF-8', async () => {
    const fileName = 'notes.markdown';
    const filePath = join(deps.root, 'owned', fileName);
    const source = `\ufeff# 标题\r\n\r\n${'正文\r\n\r\n'.repeat(40_000)}末尾\r\n`;
    writeFileSync(filePath, source);
    deps.sessionAttachments.mockReturnValue([{ attachmentId: ATTACHMENT, sessionId: SESSION, filePath, fileName, mimeType: 'text/markdown', kind: 'file' }]);
    const owner = { scope: 'session', attachmentId: ATTACHMENT, sessionId: SESSION } as const;
    await expect(invoke({ owner: { ...owner, sessionId: 'wrong' }, action: 'preview' }))
      .resolves.toEqual({ kind: 'error', code: 'denied' });
    expect(deps.sessionAttachments).not.toHaveBeenCalled();
    await expect(invoke({ owner, action: 'preview' })).resolves.toEqual({ kind: 'markdown', source });
    writeFileSync(filePath, Buffer.from([0xc0, 0xaf]));
    await expect(invoke({ owner, action: 'preview' })).resolves.toEqual({ kind: 'error', code: 'unsupported' });
  });

  it('opens validated associated documents and sends ordinary attachments only to folder reveal', async () => {
    const pdf = await stage('report.pdf', pdfDocument().toString('base64'));
    const office = await stage('report.docx', Buffer.from(officePackage()).toString('base64'));
    const script = await stage('read.py', Buffer.from('print("fixture")\n').toString('base64'));
    await expect(invoke({ owner: pdf, action: 'open' })).resolves.toEqual({ kind: 'opened' });
    await expect(invoke({ owner: office, action: 'open' })).resolves.toEqual({ kind: 'opened' });
    await expect(invoke({ owner: script, action: 'open' })).resolves.toEqual({ kind: 'error', code: 'unsupported' });
    await expect(invoke({ owner: script, action: 'reveal' })).resolves.toEqual({ kind: 'revealed' });
    expect(deps.openPath).toHaveBeenCalledTimes(2);
    for (const [index, owner] of [pdf, office].entries()) {
      const original = attachmentStagingService.get(owner.stagingId)!.bytesPath;
      const [copy] = deps.openPath.mock.calls[index];
      expect(copy).not.toBe(original);
      expect(copy).toContain(join(deps.root, 'attachment-open-copies'));
      expect(readFileSync(copy)).toEqual(readFileSync(original));
    }
    expect(deps.showItemInFolder).toHaveBeenCalledExactlyOnceWith(attachmentStagingService.get(script.stagingId)?.bytesPath);
  });

  it('blocks renamed archives, Office active payloads and caller-supplied paths', async () => {
    const zip = zipSync({ 'note.txt': strToU8('not an Office document') });
    const archive = await stage('archive.docx', Buffer.from(zip).toString('base64'));
    const active = await stage('active.docx', Buffer.from(officePackage({ 'word/vbaProject.bin': strToU8('fixture') })).toString('base64'));
    const brokenRoot = await stage('broken.docx', Buffer.from(officePackage({ '_rels/.rels': strToU8('<Relationships/>') })).toString('base64'));
    const fakePdf = await stage('fake.pdf', Buffer.from('%PDF-1.4\nstartxref\n12\n%%EOF\n').toString('base64'));
    for (const owner of [archive, active, brokenRoot, fakePdf]) {
      await expect(invoke({ owner, action: 'open' })).resolves.toEqual({ kind: 'error', code: 'unsupported' });
    }
    await expect(invoke({ owner: archive, action: 'open', path: '../outside.docx' })).rejects.toThrow();
    expect(deps.openPath).not.toHaveBeenCalled();
  });

  it('preserves the committed original after a host edit and removes a failed-open copy', async () => {
    const fileName = 'report.docx';
    const filePath = join(deps.root, 'owned', fileName);
    const bytes = officePackage();
    writeFileSync(filePath, bytes);
    deps.sessionAttachments.mockReturnValue([{ attachmentId: ATTACHMENT, sessionId: SESSION, filePath, fileName, mimeType: DOCX_MIME, kind: 'file' }]);
    const owner = { scope: 'session', attachmentId: ATTACHMENT, sessionId: SESSION } as const;
    deps.openPath.mockImplementationOnce(async (copy: string) => { writeFileSync(copy, 'host edit'); return ''; });
    await expect(invoke({ owner, action: 'open' })).resolves.toEqual({ kind: 'opened' });
    expect(readFileSync(filePath)).toEqual(Buffer.from(bytes));
    await expect(invoke({ owner, action: 'reveal' })).resolves.toEqual({ kind: 'revealed' });
    expect(deps.showItemInFolder).toHaveBeenLastCalledWith(filePath);
    deps.openPath.mockResolvedValueOnce('no association');
    await expect(invoke({ owner, action: 'open' })).resolves.toEqual({ kind: 'error', code: 'openFailed' });
    expect(readdirSync(join(deps.root, 'attachment-open-copies'))).toHaveLength(1);
  });

  it('clears old idle copies and retains copies with current activity or an Office owner file', async () => {
    const root = join(deps.root, 'attachment-open-copies');
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    for (const name of ['document-expire', 'document-recent', 'document-locked']) {
      const dir = join(root, name);
      mkdirSync(dir, { recursive: true });
      const file = join(dir, 'report.docx');
      writeFileSync(file, 'fixture');
      if (name !== 'document-recent') utimesSync(file, old, old);
      if (name === 'document-locked') writeFileSync(join(dir, '~$report.docx'), 'owner');
      utimesSync(dir, old, old);
    }
    await pruneAttachmentDocumentCopies(root);
    expect(readdirSync(root).sort()).toEqual(['document-locked', 'document-recent']);
  });

  it('rejects a committed path outside its attachment directory before opening or revealing it', async () => {
    const fileName = 'report.docx';
    const filePath = join(deps.root, fileName);
    writeFileSync(filePath, officePackage());
    deps.sessionAttachments.mockReturnValue([{ attachmentId: ATTACHMENT, sessionId: SESSION, filePath, fileName, mimeType: DOCX_MIME, kind: 'file' }]);
    const owner = { scope: 'session', attachmentId: ATTACHMENT, sessionId: SESSION } as const;
    await expect(invoke({ owner, action: 'open' })).resolves.toEqual({ kind: 'error', code: 'denied' });
    await expect(invoke({ owner, action: 'reveal' })).resolves.toEqual({ kind: 'error', code: 'denied' });
    expect(deps.openPath).not.toHaveBeenCalled();
    expect(deps.showItemInFolder).not.toHaveBeenCalled();
  });

  const sessionMarkdown = (source: string) => {
    const fileName = 'notes.md';
    const filePath = join(deps.root, 'owned', fileName);
    writeFileSync(filePath, source);
    deps.sessionAttachments.mockReturnValue([{ attachmentId: ATTACHMENT, sessionId: SESSION, filePath, fileName, mimeType: 'text/markdown', kind: 'file' }]);
    return { owner: { scope: 'session', attachmentId: ATTACHMENT, sessionId: SESSION } as const, filePath };
  };

  it('refuses bytes that changed between the listing stat and the read', async () => {
    const { owner, filePath } = sessionMarkdown('# before\n');
    const open = fsPromises.open.bind(fsPromises);
    vi.spyOn(fsPromises, 'open').mockImplementationOnce(async (...args: Parameters<typeof fsPromises.open>) => {
      writeFileSync(filePath, '# replaced with a longer body\n');
      return open(...args);
    });
    await expect(invoke({ owner, action: 'preview' })).resolves.toEqual({ kind: 'error', code: 'unavailable' });
  });

  it('propagates an unexpected read fault instead of reporting the attachment as unavailable', async () => {
    const { owner } = sessionMarkdown('# notes\n');
    vi.spyOn(fsPromises, 'open').mockRejectedValueOnce(Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }));
    await expect(invoke({ owner, action: 'preview' })).rejects.toThrow('EACCES');
  });
});

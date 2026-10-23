import { beforeEach, describe, expect, it, vi } from 'vitest';

const { read, recordedRequest } = vi.hoisted(() => ({
  read: vi.fn(),
  recordedRequest: vi.fn(),
}));
vi.mock('../../../sessions/RecordedRdcRequest', () => ({ materializeRecordedRdcRequest: recordedRequest }));

vi.mock('../../../sessions/SessionArtifactResolver', () => ({
  sessionArtifactResolver: { read },
}));

import { SessionArtifactError } from '@shared/types/sessionArtifact';
import { artifactReadTool } from './ArtifactReadTool';
import { grantDelegatedArtifactAccess } from '../../../sessions/DelegatedArtifactAccess';

describe('ArtifactReadTool', () => {
  beforeEach(() => { read.mockReset(); recordedRequest.mockReset(); });
  it('keeps decoded text search inside the same delegated URI/hash and exposes its separate provenance', async () => {
    const uri = 'session://tool-outputs/text.json';
    const hash = 'd'.repeat(64);
    const textView = { pointer: '/source', sha256: 'e'.repeat(64), bytes: 100, layers: [] };
    read.mockReturnValue({ uri, mimeType: 'application/json', hash, bytes: 200, text: '{"matches":[]}', truncated: false, textView, search: { query: 'needle', totalMatches: 0, returnedMatches: 0 } });
    const release = grantDelegatedArtifactAccess('child-text', 'parent-text', [uri], { read });
    read.mockClear();
    const context = { workspaceRoot: 'D:/ws', projectRootPath: 'D:/ws', projectId: 'p', sessionId: 'child-text' };
    try {
      const result = await artifactReadTool.execute('search', { uri, jsonTextPointers: ['/content/0/text'], textPointer: '/source', search: 'needle' }, undefined, undefined, context);
      expect(read).toHaveBeenCalledWith('parent-text', uri, expect.objectContaining({ expectedHash: hash, textPointer: '/source', search: 'needle', jsonTextPointers: ['/content/0/text'] }));
      expect(result.details).toMatchObject({ hash, textView, search: { totalMatches: 0 } });
      expect(result.content[0]).toMatchObject({ text: expect.stringContaining(`utf8-sha256=${textView.sha256}`) });
      expect(recordedRequest).not.toHaveBeenCalled();
      read.mockClear();
      const denied = await artifactReadTool.execute('denied', { uri: 'session://tool-outputs/private.json', textPointer: '/source', search: 'needle' }, undefined, undefined, context);
      expect(denied.isError).toBe(true);
      expect(read).not.toHaveBeenCalled();
      const changed = await artifactReadTool.execute('changed', { uri, expectedHash: '0'.repeat(64), textPointer: '/source', search: 'needle' }, undefined, undefined, context);
      expect(changed.isError).toBe(true);
      expect(read).not.toHaveBeenCalled();
    } finally { release(); }
  });
  it('forwards the explicit same-operation index and rejects mixed lookup modes before reading', async () => {
    const context = { workspaceRoot: 'D:/ws', projectRootPath: 'D:/ws', projectId: 'p', sessionId: 'root', agentId: 'general' };
    const uri = 'session://tool-outputs/native.json';
    read.mockReturnValue({ uri, hash: 'a'.repeat(64), mimeType: 'application/json', bytes: 2, text: '{}', truncated: false });
    recordedRequest.mockReturnValue({ uri: 'session://tool-outputs/index.json', hash: 'b'.repeat(64), qualification: 'recorded-operation-index-only' });
    const result = await artifactReadTool.execute('index', { uri, expectedHash: 'a'.repeat(64), includeRecordedOperationIndex: true }, undefined, undefined, context);
    expect(recordedRequest).toHaveBeenCalledWith(context, uri, 'a'.repeat(64), undefined, true);
    expect(result.details?.recordedRequest?.qualification).toBe('recorded-operation-index-only');
    read.mockClear(); recordedRequest.mockClear();
    const mixed = await artifactReadTool.execute('mixed', { uri, includeRecordedRequest: true, includeRecordedOperationIndex: true }, undefined, undefined, context);
    expect(mixed.isError).toBe(true);
    expect(read).not.toHaveBeenCalled();
    expect(recordedRequest).not.toHaveBeenCalled();
  });
  it('materializes an explicitly requested journal witness separately while ordinary reads remain unchanged', async () => {
    const context = { workspaceRoot: 'D:/ws', projectRootPath: 'D:/ws', projectId: 'p', sessionId: 'root', agentId: 'general' };
    const uri = 'session://tool-outputs/native.json';
    read.mockReturnValue({ uri, hash: 'a'.repeat(64), mimeType: 'application/json', bytes: 2, text: '{}', truncated: false });
    const witness = { uri: 'session://tool-outputs/request.json', hash: 'b'.repeat(64), qualification: 'recorded-model-request-only' };
    recordedRequest.mockReturnValue(witness);
    await artifactReadTool.execute('ordinary', { uri }, undefined, undefined, context);
    expect(recordedRequest).not.toHaveBeenCalled();
    const result = await artifactReadTool.execute('lookup', { uri, expectedHash: 'a'.repeat(64), includeRecordedRequest: true }, undefined, undefined, context);
    expect(recordedRequest).toHaveBeenCalledWith(context, uri, 'a'.repeat(64));
    expect(result.details).toMatchObject({ recordedRequest: witness });
    expect(result.content[1]).toMatchObject({ type: 'text', text: expect.stringContaining('not native execution proof') });
    recordedRequest.mockImplementation(() => { throw new SessionArtifactError('ARTIFACT_REQUEST_CONFLICT'); });
    const denied = await artifactReadTool.execute('conflict', { uri, expectedHash: 'a'.repeat(64), includeRecordedRequest: true }, undefined, undefined, context);
    expect(denied.isError).toBe(true);
    expect(denied.content[0]).toMatchObject({ text: expect.stringContaining('ARTIFACT_REQUEST_CONFLICT') });
  });
  it('keeps JSON inspection inside the child exact-reference grant and its frozen hash', async () => {
    const uri = 'session://tool-outputs/data.json';
    const hash = 'b'.repeat(64);
    read.mockReturnValue({ uri, mimeType: 'application/json', hash, bytes: 2, text: '{}', truncated: false, offset: 1, limit: 1 });
    const release = grantDelegatedArtifactAccess('child-inspect', 'parent-inspect', [uri], { read });
    read.mockClear();
    const context = { workspaceRoot: 'D:/ws', projectRootPath: 'D:/ws', projectId: 'p', sessionId: 'child-inspect' };
    try {
      const allowed = await artifactReadTool.execute('allowed', { uri, jsonTextPointers: [] }, undefined, undefined, context);
      expect(allowed.isError).not.toBe(true);
      expect(read).toHaveBeenCalledWith('parent-inspect', uri, expect.objectContaining({ expectedHash: hash, jsonTextPointers: [] }));
      const denied = await artifactReadTool.execute('ungranted', { uri: 'session://tool-outputs/private.json', jsonTextPointers: [] }, undefined, undefined, context);
      expect(denied.isError).toBe(true);
      const changedHash = await artifactReadTool.execute('changed', { uri, expectedHash: 'c'.repeat(64), jsonTextPointers: [] }, undefined, undefined, context);
      expect(changedHash.isError).toBe(true);
      expect(read).toHaveBeenCalledTimes(1);
    } finally { release(); }
  });

  it('forwards controlled JSON inspection after scope resolution and labels it separately from the displayed body', async () => {
    const inspection = { layers: [], rootType: 'array', numberCount: 3, nonFiniteNumberCount: 0, nodeCount: 4, arrayCount: 1, arrayLengths: { '3': 1 } };
    read.mockReturnValue({ uri: 'session://tool-outputs/data.json', mimeType: 'application/json', hash: 'a'.repeat(64), bytes: 1000, text: '{', truncated: true, offset: 1, limit: 1, jsonInspection: inspection });
    const result = await artifactReadTool.execute('inspect', { uri: 'session://tool-outputs/data.json', expectedHash: 'a'.repeat(64), limit: 1, jsonTextPointers: ['/payload'] }, undefined, undefined, { workspaceRoot: 'D:/ws', projectRootPath: 'D:/ws', projectId: 'p', sessionId: 'sess-1' });
    expect(read).toHaveBeenLastCalledWith('sess-1', 'session://tool-outputs/data.json', expect.objectContaining({ expectedHash: 'a'.repeat(64), jsonTextPointers: ['/payload'] }));
    expect(result.details).toMatchObject({ truncated: true, jsonInspection: inspection });
    expect(result.content[1]).toMatchObject({ type: 'text', text: expect.stringContaining('not domain validation') });
  });

  it('fail-closes without an active owning session', async () => {
    const result = await artifactReadTool.execute(
      'c1',
      { uri: 'session://tool-outputs/a.json' },
      undefined,
      undefined,
      { workspaceRoot: 'D:/ws', projectRootPath: 'D:/ws', projectId: null, sessionId: null },
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('ARTIFACT_SESSION_DENIED'),
    });
    expect(read).not.toHaveBeenCalled();
  });

  it('reads through the resolver for the owning session', async () => {
    read.mockReturnValue({
      uri: 'session://tool-outputs/a.json',
      mimeType: 'application/json',
      hash: 'abc123',
      bytes: 11,
      text: '{"ok":true}',
      truncated: false,
      offset: 1,
      limit: 2000,
      totalLines: 1,
      owner: 'sess-1',
      source: { toolName: 'grep', toolCallId: 'tc-big' },
    });
    const result = await artifactReadTool.execute(
      'c2',
      { uri: 'session://tool-outputs/a.json', expectedHash: 'abc123' },
      undefined,
      undefined,
      { workspaceRoot: 'D:/ws', projectRootPath: 'D:/ws', projectId: 'p', sessionId: 'sess-1' },
    );
    expect(result.isError).not.toBe(true);
    expect(read).toHaveBeenCalledWith('sess-1', 'session://tool-outputs/a.json', {
      offset: undefined,
      column: undefined,
      maxBytes: 16384,
      limit: undefined,
      expectedHash: 'abc123',
    });
    expect(result.details).toMatchObject({
      uri: 'session://tool-outputs/a.json',
      hash: 'abc123',
      bytes: 11,
      mimeType: 'application/json',
      owner: 'sess-1',
      source: { toolName: 'grep', toolCallId: 'tc-big' },
    });
  });

  it('surfaces resolver error codes', async () => {
    read.mockImplementation(() => {
      throw new SessionArtifactError('ARTIFACT_PATH_ESCAPE', 'no');
    });
    const result = await artifactReadTool.execute(
      'c3',
      { uri: 'session://tool-outputs/../x.json' },
      undefined,
      undefined,
      { workspaceRoot: 'D:/ws', projectRootPath: 'D:/ws', projectId: null, sessionId: 'sess-1' },
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('ARTIFACT_PATH_ESCAPE'),
    });
  });
  it('returns native image evidence with its hash and rejects text-only routes', async () => {
    read.mockImplementation((_session, _uri, options) => ({ uri: 'session://tool-outputs/before.png', mimeType: 'image/png', hash: 'abc123', bytes: 3, offset: 1, limit: 2000, truncated: false, ...(options.includeImageData ? { imageData: 'YWJj' } : {}) }));
    const context = { workspaceRoot: 'D:/ws', projectRootPath: 'D:/ws', projectId: null, sessionId: 'sess-1' };
    const result = await artifactReadTool.execute('visual', { uri: 'session://tool-outputs/before.png', expectedHash: 'abc123' }, undefined, undefined, { ...context, visionInputMode: 'native' });
    expect(result.content).toEqual([{ type: 'text', text: expect.stringContaining('sha256=abc123') }, { type: 'image', data: 'YWJj', mimeType: 'image/png' }]);
    expect(read).toHaveBeenLastCalledWith('sess-1', 'session://tool-outputs/before.png', expect.objectContaining({ expectedHash: 'abc123', includeImageData: true }));
    const denied = await artifactReadTool.execute('text', { uri: 'session://tool-outputs/before.png' }, undefined, undefined, { ...context, visionInputMode: 'disabled' });
    expect(denied.isError).toBe(true);
    expect(denied.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('VISION_INPUT_UNSUPPORTED') });
  });

});

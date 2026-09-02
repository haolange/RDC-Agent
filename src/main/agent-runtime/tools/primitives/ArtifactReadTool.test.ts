import { describe, expect, it, vi } from 'vitest';

const { read } = vi.hoisted(() => ({
  read: vi.fn(),
}));

vi.mock('../../../sessions/SessionArtifactResolver', () => ({
  sessionArtifactResolver: { read },
}));

import { SessionArtifactError } from '@shared/types/sessionArtifact';
import { artifactReadTool } from './ArtifactReadTool';

describe('ArtifactReadTool', () => {
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
});

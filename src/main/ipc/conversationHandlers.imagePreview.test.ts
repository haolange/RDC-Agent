import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  handle,
  readToolImagePreviewDataUrl,
  readAttachmentFilePreviewDataUrl,
  assertAttachmentPreviewPath,
  listSessionAttachments,
  getSessionAttachmentsDir,
} = vi.hoisted(() => ({
  handle: vi.fn(),
  readToolImagePreviewDataUrl: vi.fn(),
  readAttachmentFilePreviewDataUrl: vi.fn(),
  assertAttachmentPreviewPath: vi.fn((_root: string, filePath: string) => filePath),
  listSessionAttachments: vi.fn(),
  getSessionAttachmentsDir: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: { handle },
}));

vi.mock('../conversation/ToolImagePreviewStore', () => ({
  readToolImagePreviewDataUrl,
}));

vi.mock('../conversation/ConversationService', () => ({
  conversationService: {},
}));

vi.mock('../conversation/attachmentPreview', () => ({
  readAttachmentFilePreviewDataUrl,
  assertAttachmentPreviewPath,
}));

vi.mock('../sessions/StorageAdapter', () => ({
  storageAdapter: {
    listSessionAttachments,
    getSessionAttachmentsDir,
  },
}));

vi.mock('../conversation/AttachmentStagingService', () => ({
  attachmentStagingService: {
    clearAll: vi.fn(),
    stage: vi.fn(),
    release: vi.fn(),
    readPreviewDataUrl: vi.fn(),
  },
}));

import { registerConversationHandlers } from './conversationHandlers';

describe('conversation:getToolImagePreview', () => {
  beforeEach(() => {
    handle.mockReset();
    readToolImagePreviewDataUrl.mockReset();
  });

  function invoke(state: { currentSessionId: string | null }, args: unknown[]) {
    registerConversationHandlers({
      state: { currentSessionId: state.currentSessionId, currentProjectId: 'p1', currentRunId: null },
    } as never);
    const registration = handle.mock.calls.find((call) => call[0] === 'conversation:getToolImagePreview');
    if (!registration) throw new Error('handler not registered');
    return (registration[1] as (...raw: unknown[]) => Promise<unknown>)({}, ...args);
  }

  it('denies previews for a session that is not current', async () => {
    const result = await invoke({ currentSessionId: 'session-current' }, [{
      sessionId: 'session-other',
      previewId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    }]);
    expect(result).toEqual({ dataUrl: null, error: 'IMAGE_PREVIEW_SESSION_DENIED' });
    expect(readToolImagePreviewDataUrl).not.toHaveBeenCalled();
  });

  it('returns the data URL for the active session', async () => {
    readToolImagePreviewDataUrl.mockReturnValue('data:image/png;base64,abc');
    const result = await invoke({ currentSessionId: 'session-current' }, [{
      sessionId: 'session-current',
      previewId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    }]);
    expect(result).toEqual({ dataUrl: 'data:image/png;base64,abc' });
  });
});

describe('conversation:getAttachmentPreview', () => {
  beforeEach(() => {
    handle.mockReset();
    readAttachmentFilePreviewDataUrl.mockReset();
    assertAttachmentPreviewPath.mockReset();
    assertAttachmentPreviewPath.mockImplementation((_root: string, filePath: string) => filePath);
    listSessionAttachments.mockReset();
    getSessionAttachmentsDir.mockReset();
  });

  function invoke(state: { currentSessionId: string | null }, args: unknown[]) {
    registerConversationHandlers({
      state: { currentSessionId: state.currentSessionId, currentProjectId: 'p1', currentRunId: null },
    } as never);
    const registration = handle.mock.calls.find((call) => call[0] === 'conversation:getAttachmentPreview');
    if (!registration) throw new Error('handler not registered');
    return (registration[1] as (...raw: unknown[]) => Promise<unknown>)({}, ...args);
  }

  it('denies session previews that are not the active session', async () => {
    const result = await invoke({ currentSessionId: 'session-current' }, [{
      previewId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      sessionId: 'session-other',
    }]);
    expect(result).toEqual({ dataUrl: null, error: 'IMAGE_PREVIEW_SESSION_DENIED' });
    expect(listSessionAttachments).not.toHaveBeenCalled();
  });

  it('rejects session attachment paths that escape the attachments directory', async () => {
    listSessionAttachments.mockReturnValue([{
      attachmentId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      sessionId: 'session-current',
      mimeType: 'image/png',
      filePath: 'C:\\escape\\secret.png',
    }]);
    getSessionAttachmentsDir.mockReturnValue('C:\\sessions\\session-current\\attachments');
    assertAttachmentPreviewPath.mockImplementation(() => {
      throw new Error('IMAGE_PREVIEW_PATH_ESCAPE');
    });
    const result = await invoke({ currentSessionId: 'session-current' }, [{
      previewId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      sessionId: 'session-current',
    }]);
    expect(result).toEqual({ dataUrl: null, error: 'IMAGE_PREVIEW_PATH_ESCAPE' });
    expect(readAttachmentFilePreviewDataUrl).not.toHaveBeenCalled();
  });
});

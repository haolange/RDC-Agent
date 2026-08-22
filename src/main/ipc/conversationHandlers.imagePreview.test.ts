import { beforeEach, describe, expect, it, vi } from 'vitest';

const { handle, readToolImagePreviewDataUrl } = vi.hoisted(() => ({
  handle: vi.fn(),
  readToolImagePreviewDataUrl: vi.fn(),
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

vi.mock('../sessions/StorageAdapter', () => ({
  storageAdapter: {},
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

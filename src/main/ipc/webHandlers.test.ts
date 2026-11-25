import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerWebHandlers } from './webHandlers';
import type { WorkbenchIpcContext } from './workbenchContext';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  fetchRemoteImage: vi.fn(async () => ({ dataUrl: 'data:image/png;base64,AA==' })),
  audit: vi.fn(),
  history: [] as unknown[],
}));

vi.mock('electron', () => ({ ipcMain: { handle: (channel: string, listener: (...args: unknown[]) => unknown) => mocks.handlers.set(channel, listener) } }));
vi.mock('../media/RemoteImageService', () => ({ fetchRemoteImage: mocks.fetchRemoteImage }));
vi.mock('../media/FaviconResolveService', () => ({ resolveFaviconDataUrl: vi.fn() }));
vi.mock('../runtime/AuditLog', () => ({ auditLog: { record: mocks.audit }, auditArgumentsHash: () => 'sha256:url' }));
vi.mock('../sessions/store/sessionStores', () => ({ conversationHistoryStore: { readConversationHistory: () => mocks.history } }));

const fetchImage = (request: unknown) => mocks.handlers.get('web:fetchImage')!({}, request);

describe('web:fetchImage', () => {
  beforeEach(() => {
    mocks.handlers.clear();
    mocks.fetchRemoteImage.mockClear();
    mocks.audit.mockClear();
    mocks.history = [{ id: 'u1', role: 'user', content: 'see https://user.example/ref.png', createdAt: 1, updatedAt: 1 }];
    registerWebHandlers({ state: { currentSessionId: 'session-a' } } as unknown as WorkbenchIpcContext);
  });

  it('loads an image by itself only when a non-model source in the session supplied its URL', async () => {
    await expect(fetchImage({ sessionId: 'session-a', url: 'https://user.example/ref.png', intent: 'auto' }))
      .resolves.toEqual({ dataUrl: 'data:image/png;base64,AA==' });
    await expect(fetchImage({ sessionId: 'session-a', url: 'https://model.example/made-up.png', intent: 'auto' }))
      .resolves.toEqual({ dataUrl: null, error: 'REMOTE_IMAGE_UNVERIFIED' });
    expect(mocks.fetchRemoteImage).toHaveBeenCalledOnce();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('fetches a model-supplied URL when the person asks, after recording it', async () => {
    await fetchImage({ sessionId: 'session-a', url: 'https://model.example/made-up.png', intent: 'click' });
    expect(mocks.audit).toHaveBeenCalledWith({ kind: 'network', purpose: 'remote-image', host: 'model.example', urlSha256: 'sha256:url', sessionId: 'session-a' });
    expect(mocks.audit.mock.invocationCallOrder[0]).toBeLessThan(mocks.fetchRemoteImage.mock.invocationCallOrder[0]);
  });

  it('refuses a session that is not the active one', async () => {
    await expect(fetchImage({ sessionId: 'session-b', url: 'https://user.example/ref.png', intent: 'auto' })).rejects.toThrow(/SESSION_OWNER_DENIED/);
  });
});

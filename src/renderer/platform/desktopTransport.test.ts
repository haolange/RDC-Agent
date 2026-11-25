import { describe, expect, it, vi } from 'vitest';
import { IPC_ERROR_KEY, RendererIpcError } from '@shared/errors/appError';
import { createRendererApi } from '@shared/renderer-api';
import { createDesktopTransport } from './desktopTransport';
import type { DesktopIpc } from '@shared/renderer-api/transport';

function fakeIpc(invokeResult: unknown = null) {
  const unsubscribe = vi.fn();
  const ipc = {
    platform: 'win32',
    invoke: vi.fn(async () => invokeResult),
    subscribe: vi.fn(() => unsubscribe),
  } satisfies DesktopIpc;
  return { ipc, unsubscribe, api: createRendererApi('win32', createDesktopTransport(ipc)) };
}

describe('desktop renderer API', () => {
  it('removes exactly the subscription a listener made', () => {
    const { ipc, unsubscribe, api } = fakeIpc();
    const callback = vi.fn();

    api.conversation.onEvent(callback);
    expect(ipc.subscribe).toHaveBeenCalledWith('conversation:event', callback);
    api.conversation.offEvent(callback);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('throws a failed call as RendererIpcError with its code, params and class', async () => {
    const { api } = fakeIpc({
      [IPC_ERROR_KEY]: { code: 'CONVERSATION_BUSY', params: { sessions: 1 }, category: 'availability', technical: 'CONVERSATION_BUSY: a turn is running' },
    });

    const failure = await api.session.list().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(RendererIpcError);
    expect(failure).toMatchObject({ code: 'CONVERSATION_BUSY', params: { sessions: 1 }, category: 'availability', channel: 'session:list' });
  });

  it('routes settings mutations through the canonical settings:set channel', async () => {
    const { ipc, api } = fakeIpc({ appearance: { language: 'en' } });
    await api.settings.set({ appearance: { language: 'en' } });
    expect(ipc.invoke).toHaveBeenCalledWith('settings:set', { appearance: { language: 'en' } });
  });
});

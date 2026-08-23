import { describe, expect, it } from 'vitest';
import {
  RENDERER_EVENT_CHANNELS,
  RENDERER_INVOKE_CHANNELS,
  createRendererApi,
  isRendererEventChannel,
  isRendererInvokeChannel,
} from './index';
import type {
  RendererApiTransport,
  RendererEventCallback,
} from './transport';
import type { RendererEventChannel, RendererInvokeChannel } from './channels';

class RecordingTransport implements RendererApiTransport {
  readonly invocations: Array<{ channel: RendererInvokeChannel; args: unknown[] }> = [];
  readonly subscriptions: RendererEventChannel[] = [];
  readonly addedListeners: RendererEventChannel[] = [];
  readonly removedListeners: RendererEventChannel[] = [];
  readonly clearedListeners: RendererEventChannel[] = [];

  async invoke<TResult>(channel: RendererInvokeChannel, ...args: unknown[]): Promise<TResult> {
    this.invocations.push({ channel, args });
    return undefined as TResult;
  }

  subscribe(channel: RendererEventChannel, callback: RendererEventCallback): () => void {
    this.subscriptions.push(channel);
    callback({});
    return () => this.removedListeners.push(channel);
  }

  addListener(channel: RendererEventChannel, callback: RendererEventCallback): void {
    this.addedListeners.push(channel);
    callback({});
  }

  removeListener(channel: RendererEventChannel, _callback: RendererEventCallback): void {
    this.removedListeners.push(channel);
  }

  removeAllListeners(channel: RendererEventChannel): void {
    this.clearedListeners.push(channel);
  }
}

type ApiFunction = (...args: unknown[]) => unknown;

function listApiFunctions(value: unknown, prefix = ''): Array<{ path: string; fn: ApiFunction }> {
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) => {
    const entryPath = prefix ? `${prefix}.${key}` : key;
    if (typeof entry === 'function') return [{ path: entryPath, fn: entry as ApiFunction }];
    return listApiFunctions(entry, entryPath);
  });
}

describe('canonical renderer API', () => {
  it('keeps invoke and event manifests unique', () => {
    expect(new Set(RENDERER_INVOKE_CHANNELS).size).toBe(RENDERER_INVOKE_CHANNELS.length);
    expect(new Set(RENDERER_EVENT_CHANNELS).size).toBe(RENDERER_EVENT_CHANNELS.length);
    expect(isRendererInvokeChannel('settings:set')).toBe(true);
    expect(isRendererInvokeChannel('settings:getProviderSecret')).toBe(false);
    expect(isRendererEventChannel('conversation:event')).toBe(true);
    expect(isRendererEventChannel('internal:event')).toBe(false);
  });

  it('routes every ElectronAPI method and event through the canonical transport', async () => {
    const transport = new RecordingTransport();
    const api = createRendererApi('win32', transport);
    const callback = () => undefined;

    for (const entry of listApiFunctions(api)) {
      if (entry.path === 'on' || entry.path === 'off') {
        entry.fn('app:themeChanged', callback);
        continue;
      }
      if (entry.path === 'conversation.onEvent' || entry.path === 'conversation.offEvent') {
        entry.fn(callback);
        continue;
      }
      if (entry.path.startsWith('events.on')) {
        const unsubscribe = entry.fn(callback);
        if (typeof unsubscribe === 'function') unsubscribe();
        continue;
      }
      if (entry.path === 'events.removeAllListeners') {
        entry.fn('app:themeChanged');
        continue;
      }
      await entry.fn('arg-1', 'arg-2', 'arg-3', 'arg-4');
    }

    for (const channel of RENDERER_EVENT_CHANNELS) {
      api.on(channel, callback);
      api.off(channel, callback);
    }
    const addedBeforeUnknown = transport.addedListeners.length;
    api.on('internal:event', callback);
    api.off('internal:event', callback);

    expect(transport.invocations.map(({ channel }) => channel).sort()).toEqual(
      [...RENDERER_INVOKE_CHANNELS].sort(),
    );
    expect(new Set(transport.addedListeners)).toEqual(new Set(RENDERER_EVENT_CHANNELS));
    expect(new Set(transport.removedListeners)).toEqual(new Set(RENDERER_EVENT_CHANNELS));
    expect(transport.addedListeners).toHaveLength(addedBeforeUnknown);
    expect(transport.clearedListeners).toContain('app:themeChanged');
  });

  it('routes the formerly browser-disabled product capabilities through one transport', async () => {
    const transport = new RecordingTransport();
    const api = createRendererApi('win32', transport);

    await api.appShell.copyText('copied');
    await api.appShell.readClipboardText();
    await api.settings.set({ appearance: { language: 'en' } });
    await api.settings.getModelsOverride();
    await api.settings.setModelsOverride({ schemaVersion: 1, providers: {} });
    await api.memory.issueApprovalToken({ action: 'memory.write', scope: 'user' });
    await api.memory.list('user');
    await api.command.execute({ input: '/help' });
    await api.conversation.answerToolApproval({
      sessionId: 'session-1',
      turnId: 'turn-1',
      approvalId: 'approval-1',
      approved: true,
    });
    await api.mcp.getStatusSummary();
    await api.rdxRuntime.trustHook('D:\\project', 'hook-1');
    await api.rdxRuntime.revokeHook('D:\\project', 'hook-1');
    await api.rdxRuntime.trustMcp('D:\\project', 'mcp-1');
    await api.rdxRuntime.revokeMcp('D:\\project', 'mcp-1');
    await api.rdxRuntime.testHook('tool.before-call', 'D:\\project', 'hook-1');

    expect(transport.invocations.map(({ channel }) => channel)).toEqual([
      'app:copyText',
      'app:readClipboardText',
      'settings:set',
      'settings:getModelsOverride',
      'settings:setModelsOverride',
      'memory:issueApprovalToken',
      'memory:list',
      'command:execute',
      'conversation:answerToolApproval',
      'mcp:getStatusSummary',
      'rdx-runtime:trustHook',
      'rdx-runtime:revokeHook',
      'rdx-runtime:trustMcp',
      'rdx-runtime:revokeMcp',
      'rdx-runtime:testHook',
    ]);
  });
});

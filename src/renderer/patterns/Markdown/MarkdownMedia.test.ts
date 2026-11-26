import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { MarkdownMedia } from './MarkdownMedia';
import { MarkdownSourceProvider } from './markdownSources';

const fetchRemoteImage = vi.hoisted(() => vi.fn());
vi.mock('../../hooks/appShellBridge', () => ({ fetchRemoteImage }));
vi.mock('../../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  fetchRemoteImage.mockReset();
});

it('shows an image only the model linked as a placeholder, and loads it when the person asks', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:image', revokeObjectURL: () => undefined }));
  fetchRemoteImage.mockImplementation(async ({ intent }: { intent: string }) =>
    intent === 'auto' ? { unverified: true } : { dataUrl: 'data:image/png;base64,AA==' },
  );
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        createElement(MarkdownSourceProvider, {
          sources: [],
          sessionId: 'session-a',
          children: createElement(MarkdownMedia, { src: 'https://model.example/made-up.png', alt: '' }),
        }),
      ),
    );
    const pending = host.querySelector('[data-testid="markdown-media-pending"]')!;
    expect(pending.textContent).toContain('model.example');
    expect(host.querySelector('img')).toBeNull();
    expect(fetchRemoteImage).toHaveBeenCalledWith({
      sessionId: 'session-a',
      url: 'https://model.example/made-up.png',
      intent: 'auto',
    });

    await act(async () => pending.querySelector('button')!.click());
    expect(fetchRemoteImage).toHaveBeenLastCalledWith({
      sessionId: 'session-a',
      url: 'https://model.example/made-up.png',
      intent: 'click',
    });
    expect(host.querySelector('img.markdown-media-image')?.getAttribute('src')).toBe('blob:image');
  } finally {
    await act(async () => root.unmount());
  }
});

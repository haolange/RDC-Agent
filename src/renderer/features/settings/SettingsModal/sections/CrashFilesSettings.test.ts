import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { CrashFilesSettings } from './CrashFilesSettings';

const crashFiles = vi.hoisted(() => ({
  readCrashFiles: vi.fn(async () => ({ count: 3, bytes: 3 * 1024 * 1024 })),
  clearCrashFiles: vi.fn(async () => ({ count: 0, bytes: 0 })),
}));
vi.mock('../../../../platform/crashFiles', () => crashFiles);
vi.mock('../../../../i18n', () => ({
  useI18n: () => ({
    language: 'en',
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key),
  }),
}));

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

it('shows how many crash files are kept and their size, and clears them', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(CrashFilesSettings)));
    const row = host.querySelector('[data-testid="settings-crash-files"]')!;
    expect(row.textContent).toContain('settings.crashFilesSummary {"count":3,"size":"3 MB"}');
    const clear = row.querySelector<HTMLButtonElement>('button')!;
    expect(clear.disabled).toBe(false);

    await act(async () => clear.click());
    expect(crashFiles.clearCrashFiles).toHaveBeenCalledOnce();
    expect(row.textContent).toContain('settings.crashFilesNone');
    expect(clear.disabled).toBe(true);
  } finally {
    act(() => root.unmount());
  }
});

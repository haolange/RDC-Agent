// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useSettingsAutosave } from './useSettingsAutosave';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('saves after the user pauses, at once on blur, and never while nothing changed', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const save = vi.fn(async () => undefined);
  let flush = () => {};
  let status = '';
  const Probe = ({ draft, pending }: { draft: string; pending: boolean }) => {
    const autosave = useSettingsAutosave(draft, pending, save);
    flush = autosave.flush; status = autosave.status;
    return null;
  };
  const host = document.createElement('div');
  const root = createRoot(host);
  await act(async () => root.render(createElement(Probe, { draft: 'a', pending: false })));
  await act(async () => { vi.advanceTimersByTime(2000); });
  expect(save).not.toHaveBeenCalled();
  await act(async () => root.render(createElement(Probe, { draft: 'ab', pending: true })));
  await act(async () => { vi.advanceTimersByTime(500); });
  await act(async () => root.render(createElement(Probe, { draft: 'abc', pending: true })));
  await act(async () => { vi.advanceTimersByTime(500); });
  expect(save).not.toHaveBeenCalled();
  await act(async () => { vi.advanceTimersByTime(500); });
  expect(save).toHaveBeenCalledTimes(1);
  expect(status).toBe('saved');
  await act(async () => { flush(); });
  expect(save).toHaveBeenCalledTimes(2);
  await act(async () => root.unmount());
});

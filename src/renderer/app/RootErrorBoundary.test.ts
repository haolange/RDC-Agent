import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { RootErrorBoundary } from './RootErrorBoundary';
import { readRendererCrashBoot } from './rendererCrashBoot';

const report = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('../platform/rendererFaults', () => ({ reportRendererFault: report }));

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('shows the failure page for a render-time exception and reports it to main', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const Broken = () => {
    throw new Error('render exploded');
  };
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(RootErrorBoundary, null, createElement(Broken))));
    expect(host.querySelector('[data-testid="renderer-failure-page"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="renderer-failure-reload"]')).not.toBeNull();
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ message: 'render exploded' }));
  } finally {
    act(() => root.unmount());
  }
});

it('reads the crash facts main put in the entry and reloads without them', () => {
  const boot = readRendererCrashBoot(
    new URL(
      'file:///app/index.html?theme=dark&rendererCrash=crashed&exitCode=139&crashedAt=1764151200000&lang=zh-CN',
    ) as unknown as Location,
  );
  expect(boot).toMatchObject({
    language: 'zh-CN',
    reloadUrl: 'file:///app/index.html?theme=dark',
    facts: expect.arrayContaining([
      { label: 'Reason', value: 'crashed' },
      { label: 'Exit code', value: '139' },
      { label: 'Crashed at', value: '2025-11-26T10:00:00.000Z' },
    ]),
  });
  expect(readRendererCrashBoot(new URL('file:///app/index.html?theme=dark') as unknown as Location)).toBeNull();
});

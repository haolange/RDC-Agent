// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAsyncValue, type AsyncValue } from './useAsyncValue';

type Pending = { key: string; resolve: (value: string) => void; reject: (error: Error) => void; signal: AbortSignal };

describe('useAsyncValue', () => {
  let root: Root;
  let host: HTMLDivElement;
  let reads: Pending[];
  let shown: AsyncValue<string>;
  const disposed: string[] = [];

  function Probe({ valueKey }: { valueKey: string | null }) {
    shown = useAsyncValue(valueKey, (signal) => new Promise<string>((resolve, reject) => {
      reads.push({ key: valueKey ?? '', resolve, reject, signal });
    }), { dispose: (value) => disposed.push(value) });
    return null;
  }
  const render = (valueKey: string | null) => act(() => root.render(createElement(Probe, { valueKey })));
  const answer = (index: number, value: string) => act(async () => { reads[index]!.resolve(value); });

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    reads = [];
    disposed.length = 0;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it('shows the answer of the newest key only; a late answer for an earlier key is released, not shown', async () => {
    render('a');
    render('b');
    expect(shown).toEqual({ status: 'loading' });
    expect(reads[0]!.signal.aborted).toBe(true);
    await answer(1, 'value-b');
    expect(shown).toEqual({ status: 'ready', value: 'value-b' });
    await answer(0, 'value-a');
    expect(shown).toEqual({ status: 'ready', value: 'value-b' });
    expect(disposed).toEqual(['value-a']);
  });

  it('never shows a previous key\'s value while the new key loads, and releases it', async () => {
    render('a');
    await answer(0, 'value-a');
    render('b');
    expect(shown).toEqual({ status: 'loading' });
    expect(disposed).toEqual(['value-a']);
    // Coming back to a key reads it anew instead of showing what was released.
    render('a');
    expect(shown).toEqual({ status: 'loading' });
  });

  it('reports a failed read of the current key and reads nothing for a null key', async () => {
    render('a');
    await act(async () => { reads[0]!.reject(new Error('offline')); });
    expect(shown).toMatchObject({ status: 'error', error: new Error('offline') });
    render(null);
    expect(shown).toEqual({ status: 'idle' });
    expect(reads).toHaveLength(1);
  });
});

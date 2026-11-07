import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeReadResult } from '@shared/types/knowledge';
import { useKnowledgeSelection } from './useKnowledgeSelection';

const hooks = vi.hoisted(() => ({ values: [] as unknown[], cleanup: [] as (() => void)[] }));
vi.mock('react', () => ({
  useCallback: (fn: unknown) => fn,
  useRef: (value: unknown) => ({ current: value }),
  useState: (initial: unknown) => {
    const index = hooks.values.length;
    hooks.values.push(initial);
    return [initial, (value: unknown) => { hooks.values[index] = value; }];
  },
  useEffect: (effect: () => (() => void) | undefined) => {
    const cleanup = effect();
    if (cleanup) hooks.cleanup.push(cleanup);
  },
}));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const card = (id: string): KnowledgeReadResult => ({ card: { cardId: id, spaceId: 'user', relativePath: `${id}.md`, title: id,
  scope: {}, relations: [], contentHash: 'a'.repeat(64) }, content: 'preview', range: 'summary', headings: [], lineCount: 1 });
beforeEach(() => { hooks.values = []; hooks.cleanup = []; });
describe('knowledge detail request ownership', () => {
  it('a late first card cannot overwrite a newer selected card', async () => {
    const first = deferred<KnowledgeReadResult>();
    const second = deferred<KnowledgeReadResult>();
    const read = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    vi.stubGlobal('window', { electronAPI: { knowledge: { read } } });
    const state = useKnowledgeSelection({ open: true, queryKey: 'query', hits: [], pack: null, onShowDetail() {}, setError() {} });
    const oldRequest = state.selectCard('user', 'first.md', 'first');
    const newRequest = state.selectCard('user', 'second.md', 'second', 'a'.repeat(64));
    second.resolve(card('second'));
    await newRequest;
    first.resolve(card('first'));
    await oldRequest;
    expect(hooks.values[0]).toBe('second');
    expect(hooks.values[1]).toEqual({ ...card('second').card, body: '', content: '' });
    expect(hooks.values[2]).toEqual(card('second'));
    expect(hooks.values[4]).toBe(false);
    expect(read).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'summary', contentHash: 'a'.repeat(64) }));
    vi.unstubAllGlobals();
  });
  it('closing/unmounting invalidates a pending result before it can populate the next lifetime', async () => {
    const pending = deferred<KnowledgeReadResult>();
    vi.stubGlobal('window', { electronAPI: { knowledge: { read: () => pending.promise } } });
    const state = useKnowledgeSelection({ open: true, queryKey: 'query', hits: [], pack: null, onShowDetail() {}, setError() {} });
    const request = state.selectCard('user', 'first.md', 'first');
    hooks.cleanup.forEach((cleanup) => cleanup());
    pending.resolve(card('first'));
    await request;
    expect(hooks.values[1]).toBeNull();
    vi.unstubAllGlobals();
  });
});

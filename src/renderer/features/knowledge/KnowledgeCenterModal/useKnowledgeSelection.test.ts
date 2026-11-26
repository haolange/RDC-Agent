import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useKnowledgeSelection } from './useKnowledgeSelection';
import type { KnowledgeCardDetail } from '@shared/types/knowledge';

const hooks = vi.hoisted(() => ({ values: [] as unknown[], cleanup: [] as (() => void)[] }));
vi.mock('react', () => ({
  useCallback: (fn: unknown) => fn,
  useRef: (value: unknown) => ({ current: value }),
  useState: (initial: unknown) => {
    const index = hooks.values.length;
    hooks.values.push(initial);
    return [
      initial,
      (value: unknown) => {
        hooks.values[index] = value;
      },
    ];
  },
  useEffect: (effect: () => (() => void) | undefined) => {
    const cleanup = effect();
    if (cleanup) hooks.cleanup.push(cleanup);
  },
}));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const card = (id: string): { card: KnowledgeCardDetail } => ({
  card: {
    cardId: id,
    spaceId: 'user',
    relativePath: `${id}.md`,
    title: id,
    scope: {},
    relations: [],
    contentHash: 'a'.repeat(64),
    content: `# ${id}`,
    body: `# ${id}`,
  } as KnowledgeCardDetail,
});
beforeEach(() => {
  hooks.values = [];
  hooks.cleanup = [];
});
describe('knowledge detail request ownership', () => {
  it('a late first card cannot overwrite a newer selected card', async () => {
    const first = deferred<{ card: KnowledgeCardDetail }>();
    const second = deferred<{ card: KnowledgeCardDetail }>();
    const read = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    vi.stubGlobal('window', { electronAPI: { knowledge: { card: read } } });
    const state = useKnowledgeSelection({
      open: true,
      queryKey: 'query',
      hits: [],
      pack: null,
      onShowDetail() {},
      setError() {},
    });
    const oldRequest = state.selectCard('user', 'first.md', 'first');
    const newRequest = state.selectCard('user', 'second.md', 'second', 'a'.repeat(64));
    second.resolve(card('second'));
    await newRequest;
    first.resolve(card('first'));
    await oldRequest;
    expect(hooks.values[0]).toBe('second');
    expect(hooks.values[1]).toEqual(card('second').card);
    expect(hooks.values[2]).toBe(false);
    expect(read).toHaveBeenLastCalledWith('user', 'second.md');
    vi.unstubAllGlobals();
  });
  it('closing/unmounting invalidates a pending result before it can populate the next lifetime', async () => {
    const pending = deferred<{ card: KnowledgeCardDetail }>();
    vi.stubGlobal('window', { electronAPI: { knowledge: { card: () => pending.promise } } });
    const state = useKnowledgeSelection({
      open: true,
      queryKey: 'query',
      hits: [],
      pack: null,
      onShowDetail() {},
      setError() {},
    });
    const request = state.selectCard('user', 'first.md', 'first');
    hooks.cleanup.forEach((cleanup) => cleanup());
    pending.resolve(card('first'));
    await request;
    expect(hooks.values[1]).toBeNull();
    vi.unstubAllGlobals();
  });
  it('refuses a card that changed since the search hit named its version', async () => {
    const setError = vi.fn();
    vi.stubGlobal('window', { electronAPI: { knowledge: { card: async () => card('first') } } });
    const state = useKnowledgeSelection({
      open: true,
      queryKey: 'query',
      hits: [],
      pack: null,
      onShowDetail() {},
      setError,
    });
    await state.selectCard('user', 'first.md', 'first', 'b'.repeat(64));
    expect(hooks.values[1]).toBeNull();
    expect(setError).toHaveBeenLastCalledWith(expect.stringMatching(/./u));
    vi.unstubAllGlobals();
  });
});

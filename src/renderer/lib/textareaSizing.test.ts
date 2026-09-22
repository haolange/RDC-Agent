import { afterEach, describe, expect, it, vi } from 'vitest';
import { observeTextareaSizing, textareaHeight } from './textareaSizing';
import { assignDynStyle, clearDynStyle } from './useDynStyle';

vi.mock('./useDynStyle', () => ({ assignDynStyle: vi.fn(), clearDynStyle: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('textarea content sizing', () => {
  it('grows, caps at eight rows, and shrinks after deletion', () => {
    expect(textareaHeight(28, 20, 8, 2, 1, 8)).toEqual({ height: 30, overflow: 'hidden' });
    expect(textareaHeight(68, 20, 8, 2, 1, 8)).toEqual({ height: 70, overflow: 'hidden' });
    expect(textareaHeight(308, 20, 8, 2, 1, 8)).toEqual({ height: 170, overflow: 'auto' });
    expect(textareaHeight(8, 20, 8, 2, 1, 8)).toEqual({ height: 30, overflow: 'hidden' });
  });
  it('accounts for custom row bounds, border and font metrics', () => {
    expect(textareaHeight(1000, 24, 12, 4, 3, 2)).toEqual({ height: 88, overflow: 'auto' });
    expect(textareaHeight(12, 24, 12, 4, 0, 8).height).toBe(40);
  });
  it('clamps the composer writing surface between 72 and 180', () => {
    expect(textareaHeight(20, 22, 10, 0, 1, 8, 72, 180)).toEqual({ height: 72, overflow: 'hidden' });
    expect(textareaHeight(120, 22, 10, 0, 1, 8, 72, 180)).toEqual({ height: 120, overflow: 'hidden' });
    expect(textareaHeight(400, 22, 10, 0, 1, 8, 72, 180)).toEqual({ height: 180, overflow: 'auto' });
  });
  it('honors md32 with real 12px/1.5 metrics and does not clip larger fonts', () => {
    // 12px font × 1.5 line height + 8px padding + 2px border = 28px, raised to md32.
    expect(textareaHeight(30, 18, 8, 2, 1, 8, 32)).toEqual({ height: 32, overflow: 'hidden' });
    // maxRows=1 must not mark the min-height-enlarged scrollHeight as overflow.
    expect(textareaHeight(30, 18, 8, 2, 1, 1, 32)).toEqual({ height: 32, overflow: 'hidden' });
    expect(textareaHeight(30, 19.5, 8, 2, 1, 8, 32).height).toBe(32);
    expect(textareaHeight(38, 30, 8, 2, 1, 8, 32)).toEqual({ height: 40, overflow: 'hidden' });
    expect(textareaHeight(500, 19.5, 8, 2, 1, 8, 32)).toEqual({ height: 166, overflow: 'auto' });
  });
  it('remeasures input, resize, reveal and font events; releases observers and styles', async () => {
    const handlers = new Map<string, () => void>();
    const fonts = new Map<string, () => void>();
    let resize!: (entries: { contentRect: { width: number } }[]) => void;
    let mutation!: () => void;
    let pending: (() => void) | undefined;
    const disconnect = vi.fn();
    const observeMutation = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: typeof resize) { resize = callback; }
      observe = vi.fn(); disconnect = disconnect;
    });
    vi.stubGlobal('MutationObserver', class {
      constructor(callback: () => void) { mutation = callback; }
      observe = observeMutation; disconnect = disconnect;
    });
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => { pending = callback; return 1; });
    vi.stubGlobal('cancelAnimationFrame', () => { pending = undefined; });
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.stubGlobal('document', { fonts: {
      ready: Promise.resolve(),
      addEventListener: (name: string, callback: () => void) => fonts.set(name, callback),
      removeEventListener: (name: string) => fonts.delete(name),
    } });
    let lineHeight = '20px';
    vi.stubGlobal('getComputedStyle', () => ({ lineHeight, fontSize: '14px', paddingTop: '4px',
      paddingBottom: '4px', borderTopWidth: '1px', borderBottomWidth: '1px', minHeight: '32px' }));
    let visible = true;
    const root = { parentElement: null };
    const element = { scrollHeight: 30, parentElement: root,
      getClientRects: () => visible ? [{}] : [],
      addEventListener: (name: string, callback: () => void) => handlers.set(name, callback),
      removeEventListener: (name: string) => handlers.delete(name),
    } as unknown as HTMLTextAreaElement;
    const cleanup = observeTextareaSizing(element, 1, 8);
    expect(assignDynStyle).toHaveBeenLastCalledWith(element, { height: '32px', 'overflow-y': 'hidden' });
    expect(observeMutation).toHaveBeenCalledWith(root, expect.objectContaining({
      attributeFilter: expect.arrayContaining(['data-font-scale']),
    }));
    Object.defineProperty(element, 'scrollHeight', { value: 300, configurable: true });
    handlers.get('input')!();
    expect(assignDynStyle).toHaveBeenLastCalledWith(element, { height: '170px', 'overflow-y': 'auto' });
    visible = false;
    vi.mocked(assignDynStyle).mockClear();
    mutation(); pending?.();
    expect(assignDynStyle).not.toHaveBeenCalled();
    visible = true;
    resize([{ contentRect: { width: 160 } }]); pending?.();
    expect(assignDynStyle).toHaveBeenCalled();
    vi.mocked(assignDynStyle).mockClear();
    fonts.get('loadingdone')!(); pending?.();
    expect(assignDynStyle).toHaveBeenCalled();
    // App font-scale uses a root data attribute, not inline style or a width change.
    lineHeight = '30px';
    mutation(); pending?.();
    expect(assignDynStyle).toHaveBeenLastCalledWith(element, { height: '250px', 'overflow-y': 'auto' });
    cleanup();
    await Promise.resolve();
    expect(disconnect).toHaveBeenCalledTimes(2);
    expect(handlers.size).toBe(0);
    expect(fonts.size).toBe(0);
    expect(clearDynStyle).toHaveBeenCalledWith(element);
    expect(pending).toBeUndefined();
  });
});

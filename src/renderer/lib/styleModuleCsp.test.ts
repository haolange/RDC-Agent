import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const entry = require.resolve('style-mod', { paths: [require.resolve('@codemirror/view')] });
const { StyleModule } = require(entry) as {
  StyleModule: {
    new(spec: Record<string, Record<string, string>>): unknown;
    mount(root: unknown, modules: unknown[]): void;
  };
};

class ConstructedSheet {
  rules: string[] = [];
  insertRule(rule: string, index: number) { this.rules.splice(index, 0, rule); }
}

function documentRoot() {
  return {
    head: { insertBefore: vi.fn(() => { throw new Error('CSP forbids inline style'); }) },
    createElement: vi.fn(() => { throw new Error('Must not create inline style'); }),
    defaultView: { CSSStyleSheet: ConstructedSheet },
    adoptedStyleSheets: [] as ConstructedSheet[],
  };
}

describe('CodeMirror style module under strict desktop CSP', () => {
  it('mounts document styles without an inline tag and deduplicates repeated mounts', () => {
    const root = documentRoot();
    const module = new StyleModule({ '.editor': { color: 'var(--token-text-body)' } });
    StyleModule.mount(root, [module]);
    StyleModule.mount(root, [module]);
    expect(root.createElement).not.toHaveBeenCalled();
    expect(root.adoptedStyleSheets).toHaveLength(1);
    expect(root.adoptedStyleSheets[0].rules).toEqual(['.editor {color: var(--token-text-body);}']);
  });

  it('preserves rule order and adoption in a shadow root from the same document', () => {
    const root = documentRoot();
    const first = new StyleModule({ '.editor': { color: 'inherit' } });
    const second = new StyleModule({ '.editor': { color: 'var(--token-text-body)' } });
    StyleModule.mount(root, [first, second]);
    const shadow = { ownerDocument: root, adoptedStyleSheets: [] as ConstructedSheet[] };
    StyleModule.mount(shadow, [first, second]);
    expect(shadow.adoptedStyleSheets[0]).toBe(root.adoptedStyleSheets[0]);
    expect(shadow.adoptedStyleSheets[0].rules).toEqual([
      '.editor {color: inherit;}', '.editor {color: var(--token-text-body);}',
    ]);
    expect(root.createElement).not.toHaveBeenCalled();
  });
});

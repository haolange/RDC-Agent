import { useLayoutEffect, useId } from 'react';

export type DynStyleDecls = Record<string, string | number | undefined | null>;

const registry = new Map<string, string>();
let sheet: CSSStyleSheet | null = null;

function ensureSheet(): CSSStyleSheet | null {
  if (typeof document === 'undefined') return null;
  if (!sheet) {
    sheet = new CSSStyleSheet();
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  }
  return sheet;
}

function flush(): void {
  const active = ensureSheet();
  if (!active) return;
  const css = Array.from(registry, ([id, body]) => `[data-dyn-style="${id}"]{${body}}`).join('\n');
  active.replaceSync(css);
}

function toDecl(decls: DynStyleDecls): string {
  return Object.entries(decls)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}:${value}`)
    .join(';');
}

/**
 * Apply dynamic CSS declarations without inline `style` attributes.
 * Uses a constructable stylesheet so CSP may set `style-src 'self'` / `style-src-attr 'none'`.
 */
export function useDynStyle(decls: DynStyleDecls): { 'data-dyn-style': string } {
  const id = useId().replace(/:/g, '');
  const body = toDecl(decls);

  useLayoutEffect(() => {
    registry.set(id, body);
    flush();
    return () => {
      registry.delete(id);
      flush();
    };
  }, [id, body]);

  return { 'data-dyn-style': id };
}

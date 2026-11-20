import { useLayoutEffect, useId } from 'react';

export type DynStyleDecls = Record<string, string | number | undefined | null>;

const registry = new Map<string, string>();
let sheet: CSSStyleSheet | null = null;
let imperativeSeq = 0;

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
  const css = Array.from(registry, ([id, body]) => {
    const attr = id.startsWith('imp') ? 'data-imp-dyn-style' : 'data-dyn-style';
    return `[${attr}="${id}"]{${body}}`;
  }).join('\n');
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

/** Registers one element's declarations; reports whether the shared sheet must be rebuilt. */
function register(el: HTMLElement, decls: DynStyleDecls): boolean {
  let id = el.getAttribute('data-imp-dyn-style');
  if (!id) {
    id = `imp${++imperativeSeq}`;
    el.setAttribute('data-imp-dyn-style', id);
  }
  const body = toDecl(decls);
  if (registry.get(id) === (body || undefined)) return false;
  if (!body) registry.delete(id);
  else registry.set(id, body);
  return true;
}

function unregister(el: HTMLElement): boolean {
  const id = el.getAttribute('data-imp-dyn-style');
  if (!id) return false;
  el.removeAttribute('data-imp-dyn-style');
  return registry.delete(id);
}

/**
 * Imperative counterpart for DOM measurements (textarea autosize, canvas host sizing).
 * Attaches/reuses `data-dyn-style` on the element and updates the shared constructable sheet.
 */
export function assignDynStyle(el: HTMLElement, decls: DynStyleDecls): void {
  if (register(el, decls)) flush();
}

/** Applies many elements' declarations with one sheet rebuild; measure everything before calling it. */
export function assignDynStyles(entries: Iterable<readonly [HTMLElement, DynStyleDecls]>): void {
  let changed = false;
  for (const [el, decls] of entries) changed = register(el, decls) || changed;
  if (changed) flush();
}

/** Clear imperative dyn-style registration for an element (does not remove React dyn-style). */
export function clearDynStyle(el: HTMLElement): void {
  if (unregister(el)) flush();
}

/** Clears many elements' registrations with one sheet rebuild. */
export function clearDynStyles(elements: Iterable<HTMLElement>): void {
  let changed = false;
  for (const el of elements) changed = unregister(el) || changed;
  if (changed) flush();
}

import { useLayoutEffect } from 'react';

/**
 * Mermaid writes a `<style>` element and `style=` attributes into its SVG; the CSP blocks both. The rules move into a
 * constructable stylesheet: the `<style>` text as it is (Mermaid already scopes it under the diagram id) and each
 * inline declaration as a rule on a generated attribute, so the diagram renders styled without loosening `style-src`.
 */
export function extractMermaidStyles(svg: string, scopeId: string): { svg: string; css: string } {
  const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = document.documentElement;
  if (root.nodeName !== 'svg') return { svg, css: '' };
  const rules: string[] = [];
  for (const style of [...root.querySelectorAll('style')]) {
    rules.push(style.textContent);
    style.remove();
  }
  let index = 0;
  for (const element of [root, ...root.querySelectorAll('[style]')]) {
    const declarations = element.getAttribute('style');
    if (!declarations) continue;
    element.removeAttribute('style');
    index += 1;
    element.setAttribute('data-mermaid-style', String(index));
    rules.push(
      `#${CSS.escape(scopeId)}[data-mermaid-style="${index}"], #${CSS.escape(scopeId)} [data-mermaid-style="${index}"] { ${declarations} }`,
    );
  }
  return { svg: new XMLSerializer().serializeToString(root), css: rules.join('\n') };
}

/** Adopts one diagram's rules for as long as it is mounted. */
export function useAdoptedStyles(css: string): void {
  useLayoutEffect(() => {
    if (!css || typeof CSSStyleSheet === 'undefined') return undefined;
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    return () => {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((candidate) => candidate !== sheet);
    };
  }, [css]);
}

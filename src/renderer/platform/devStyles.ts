/** Vite-only CSS HMR transport. Keep the same strict CSP as the packaged renderer. */
const sheets = new Map<string, CSSStyleSheet>();

export function updateStyle(id: string, content: string): void {
  let sheet = sheets.get(id);
  if (!sheet) {
    sheet = new CSSStyleSheet();
    sheets.set(id, sheet);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  }
  sheet.replaceSync(content);
}

export function removeStyle(id: string): void {
  const sheet = sheets.get(id);
  if (!sheet) return;
  document.adoptedStyleSheets = document.adoptedStyleSheets.filter((entry) => entry !== sheet);
  sheets.delete(id);
}

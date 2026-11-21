/**
 * The main process passes the resolved theme in the entry URL; applying it before React renders keeps a light-theme
 * user from seeing the dark default palette while settings load. applyChromeTheme takes over once settings arrive.
 */
export function applyBootTheme(): void {
  const theme = new URLSearchParams(window.location.search).get('theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.resolvedTheme = theme;
}

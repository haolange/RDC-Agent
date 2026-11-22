import { useSyncExternalStore } from 'react';

type ResolvedTheme = 'light' | 'dark';

const read = (): ResolvedTheme => (document.documentElement.dataset.resolvedTheme === 'light' ? 'light' : 'dark');

const subscribe = (notify: () => void) => {
  const observer = new MutationObserver(notify);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-resolved-theme'] });
  return () => observer.disconnect();
};

/** The theme the chrome resolved to; content that bakes colours in (diagrams) redraws when it changes. */
export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(subscribe, read, () => 'dark');
}

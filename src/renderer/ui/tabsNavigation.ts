/** Resolve keyboard movement through enabled tabs; null leaves the event untouched. */
export function resolveTabNavigation(
  tabs: readonly { disabled?: boolean }[], from: number, key: string,
): number | null {
  if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(key)) return null;
  const enabled = tabs.flatMap((tab, index) => tab.disabled ? [] : [index]);
  if (enabled.length === 0) return null;
  if (key === 'Home') return enabled[0];
  if (key === 'End') return enabled[enabled.length - 1];
  const position = enabled.indexOf(from);
  if (position < 0) return key === 'ArrowLeft' ? enabled[enabled.length - 1] : enabled[0];
  return enabled[(position + (key === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length];
}

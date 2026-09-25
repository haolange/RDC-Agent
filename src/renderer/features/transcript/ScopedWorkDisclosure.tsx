import React from 'react';

const Scope = React.createContext<string | null>(null);
const choices = new Map<string, boolean>();
const MAX_CHOICES = 3_000;

export const ScopedWorkDisclosure: React.FC<{ scope?: string; children: React.ReactNode }> = ({ scope, children }) => (
  <Scope.Provider value={scope ?? null}>{children}</Scope.Provider>
);

/** Remembers only user gestures, so a changing default still controls untouched rows. */
export function useScopedWorkDisclosure(rowId: string, defaultOpen: boolean): [boolean, () => void] {
  const scope = React.useContext(Scope);
  const key = scope ? `${scope}\u0000${rowId}` : null;
  const defaultRef = React.useRef(defaultOpen);
  defaultRef.current = defaultOpen;
  const [state, setState] = React.useState(() => ({ open: key && choices.has(key) ? choices.get(key)! : defaultOpen,
    overridden: !!key && choices.has(key) }));
  const current = React.useRef(state);
  current.current = state;
  React.useEffect(() => {
    const next = { open: key && choices.has(key) ? choices.get(key)! : defaultRef.current,
      overridden: !!key && choices.has(key) };
    current.current = next;
    setState(next);
  }, [key]);
  React.useEffect(() => { setState((current) => current.overridden ? current : { ...current, open: defaultOpen }); }, [defaultOpen]);
  const toggle = React.useCallback(() => {
    const open = !current.current.open;
    const next = { open, overridden: true };
    current.current = next;
    if (key) {
      choices.delete(key);
      choices.set(key, open);
      if (choices.size > MAX_CHOICES) choices.delete(choices.keys().next().value!);
    }
    setState(next);
  }, [key]);
  return [state.open, toggle];
}

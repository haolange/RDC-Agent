import React from 'react';

const Scope = React.createContext<string | null>(null);
const choices = new Map<string, boolean>();
const MAX_CHOICES = 3_000;
export const ScopedWorkDisclosure: React.FC<{ scope?: string; children: React.ReactNode }> = ({ scope, children }) => (
  <Scope.Provider value={scope ?? null}>{children}</Scope.Provider>
);

/**
 * Remembers only user gestures, so a changing default still controls untouched rows. The open state is read while
 * rendering (the gesture remembered for this scope and row, else the default), so a new default or scope shows in the
 * frame that brings it, never one frame late behind the previous state.
 */
export function useScopedWorkDisclosure(rowId: string, defaultOpen: boolean): [boolean, () => void] {
  const scope = React.useContext(Scope);
  const key = scope === null ? null : `${scope}\u0000${rowId}`;
  // A row outside any scope keeps its gesture locally; scoped gestures outlive remounts in the shared map.
  const [localChoice, setLocalChoice] = React.useState<boolean | null>(null);
  const [, rerender] = React.useReducer((revision: number) => revision + 1, 0);
  const open = (key === null ? localChoice : choices.get(key)) ?? defaultOpen;
  const current = React.useRef(open);
  current.current = open;
  const toggle = React.useCallback(() => {
    const next = !current.current;
    if (key === null) {
      setLocalChoice(next);
      return;
    }
    choices.delete(key);
    choices.set(key, next);
    if (choices.size > MAX_CHOICES) choices.delete(choices.keys().next().value!);
    rerender();
  }, [key]);
  return [open, toggle];
}

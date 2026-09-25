import React from 'react';

type Fold = 'expanded' | 'workOpen' | 'finalOpen' | 'detailsOpen' | 'factsOpen' | 'constraintsOpen';
type Disclosure = Record<Fold, boolean>;

const empty: Disclosure = { expanded: false, workOpen: false, finalOpen: false, detailsOpen: false, factsOpen: false, constraintsOpen: false };
const states = new Map<string, Disclosure>();
const MAX_REMEMBERED = 300;

export function useSubagentDisclosure(sessionId: string | null | undefined, parentToolCallId: string) {
  const key = `${sessionId ?? ''}\u0000${parentToolCallId}`;
  const [state, setState] = React.useState<Disclosure>(() => states.get(key) ?? empty);
  const current = React.useRef(state);
  React.useEffect(() => {
    const next = states.get(key) ?? empty;
    current.current = next;
    setState(next);
  }, [key]);
  const toggle = React.useCallback((fold: Fold) => {
    const next = { ...current.current, [fold]: !current.current[fold] };
    current.current = next;
    states.delete(key);
    states.set(key, next);
    if (states.size > MAX_REMEMBERED) states.delete(states.keys().next().value!);
    setState(next);
  }, [key]);
  const openCard = React.useCallback((running: boolean) => {
    const previous = current.current;
    const next = { ...previous, expanded: !previous.expanded,
      workOpen: !previous.expanded && running && !states.has(key) ? true : previous.workOpen };
    current.current = next;
    states.delete(key);
    states.set(key, next);
    if (states.size > MAX_REMEMBERED) states.delete(states.keys().next().value!);
    setState(next);
  }, [key]);
  return { ...state, toggle, openCard };
}

import { useCallback, useState } from 'react';
import { ALL_CARD_TYPES, ALL_LIFECYCLES, toggleSetValue } from './knowledgeCenterModel';

/** Type / lifecycle multi-select; both groups start fully selected. Retrieval lanes are not a filter. */
export function useKnowledgeFilters() {
  const [types, setTypes] = useState(ALL_CARD_TYPES);
  const [lifecycles, setLifecycles] = useState(ALL_LIFECYCLES);

  const toggleType = useCallback(
    (value: (typeof ALL_CARD_TYPES)[number]) => setTypes((cur) => toggleSetValue(cur, value)),
    [],
  );
  const toggleLifecycle = useCallback(
    (value: (typeof ALL_LIFECYCLES)[number]) => setLifecycles((cur) => toggleSetValue(cur, value)),
    [],
  );

  return { types, lifecycles, toggleType, toggleLifecycle };
}

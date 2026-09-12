import { useCallback, useState } from 'react';
import type { KnowledgeRetrievalLane } from '@shared/types/knowledge';
import { ALL_CARD_TYPES, ALL_LANES, ALL_LIFECYCLES, toggleSetValue } from './knowledgeCenterModel';

/** Type / lifecycle / retrieval-lane multi-select; every group starts fully selected. */
export function useKnowledgeFilters() {
  const [types, setTypes] = useState(ALL_CARD_TYPES);
  const [lifecycles, setLifecycles] = useState(ALL_LIFECYCLES);
  const [lanes, setLanes] = useState<KnowledgeRetrievalLane[]>([...ALL_LANES]);

  const toggleType = useCallback((value: (typeof ALL_CARD_TYPES)[number]) => setTypes((cur) => toggleSetValue(cur, value)), []);
  const toggleLifecycle = useCallback((value: (typeof ALL_LIFECYCLES)[number]) => setLifecycles((cur) => toggleSetValue(cur, value)), []);
  const toggleLane = useCallback((value: (typeof ALL_LANES)[number]) => setLanes((cur) => toggleSetValue(cur, value)), []);

  return { types, lifecycles, lanes, toggleType, toggleLifecycle, toggleLane };
}

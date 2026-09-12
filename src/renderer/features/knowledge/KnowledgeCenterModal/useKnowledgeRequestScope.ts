import { useEffect, useRef } from 'react';
import { createRequestSeq } from './knowledgeCenterModel';

/** Async UI results belong to one open resource/session lifetime; writes are not cancelled. */
export function useKnowledgeRequestScope(active: boolean, scope = '') {
  const requestRef = useRef(createRequestSeq());
  const request = requestRef.current;
  useEffect(() => {
    request.next();
    return () => { request.next(); };
  }, [active, request, scope]);
  return request;
}

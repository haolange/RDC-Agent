// @vitest-environment happy-dom
import { act, createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { useKnowledgeRequestScope } from './useKnowledgeRequestScope';

describe('knowledge request scope React lifecycle', () => {
  it('invalidates results across query scope, close and unmount while retaining one request owner', () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const root = createRoot(document.createElement('div'));
    let request!: ReturnType<typeof useKnowledgeRequestScope>;
    function Probe({ open, scope }: { open: boolean; scope: string }) { request = useKnowledgeRequestScope(open, scope); return null; }
    const render = (open: boolean, scope: string) => act(() => root.render(createElement(StrictMode, null, createElement(Probe, { open, scope }))));
    try {
      render(true, 'first');
      const owner = request; const first = request.next();
      render(true, 'second');
      expect(request).toBe(owner); expect(request.isCurrent(first)).toBe(false);
      const second = request.next(); render(false, 'second');
      expect(request.isCurrent(second)).toBe(false);
      render(true, 'second'); const reopened = request.next();
      expect(request.isCurrent(reopened)).toBe(true);
      act(() => root.unmount()); expect(request.isCurrent(reopened)).toBe(false);
    } catch (error) { act(() => root.unmount()); throw error; }
  });
});

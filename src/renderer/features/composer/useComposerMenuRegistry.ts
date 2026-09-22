import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  isInsideComposerMenuRoot,
  reduceComposerMenu,
  type ComposerMenuId,
} from './composerMenuState';

export interface ComposerMenuRegistryApi {
  activeId: ComposerMenuId | null;
  open: (id: ComposerMenuId) => void;
  close: (id?: ComposerMenuId) => void;
  toggle: (id: ComposerMenuId) => void;
  isOpen: (id: ComposerMenuId) => boolean;
  setRoot: (id: ComposerMenuId, node: HTMLElement | null) => void;
  setTrigger: (id: ComposerMenuId, node: HTMLElement | null) => void;
}

const ComposerMenuRegistryContext = createContext<ComposerMenuRegistryApi | null>(null);

export function ComposerMenuRegistryProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [activeId, setActiveId] = useState<ComposerMenuId | null>(null);
  const rootsRef = useRef(new Map<ComposerMenuId, HTMLElement>());
  const triggersRef = useRef(new Map<ComposerMenuId, HTMLElement>());
  const focusFrameRef = useRef<number | null>(null);
  const activeIdRef = useRef<ComposerMenuId | null>(null);
  activeIdRef.current = activeId;

  const restoreFocus = useCallback((id: ComposerMenuId | null) => {
    if (!id) return;
    const trigger = triggersRef.current.get(id);
    if (focusFrameRef.current !== null) window.cancelAnimationFrame(focusFrameRef.current);
    focusFrameRef.current = window.requestAnimationFrame(() => {
      focusFrameRef.current = null;
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    });
  }, []);

  useEffect(() => () => {
    if (focusFrameRef.current !== null) window.cancelAnimationFrame(focusFrameRef.current);
  }, []);

  const open = useCallback((id: ComposerMenuId) => {
    setActiveId((current) => reduceComposerMenu(current, { type: 'open', id }));
  }, []);

  const close = useCallback((id?: ComposerMenuId) => {
    setActiveId((current) => {
      const next = reduceComposerMenu(current, { type: 'close', id });
      if (next === null && current) {
        restoreFocus(current);
      }
      return next;
    });
  }, [restoreFocus]);

  const toggle = useCallback((id: ComposerMenuId) => {
    setActiveId((current) => {
      const next = reduceComposerMenu(current, { type: 'toggle', id });
      if (next === null && current === id) {
        restoreFocus(id);
      }
      return next;
    });
  }, [restoreFocus]);

  const isOpen = useCallback((id: ComposerMenuId) => activeId === id, [activeId]);

  const setRoot = useCallback((id: ComposerMenuId, node: HTMLElement | null) => {
    if (node) {
      rootsRef.current.set(id, node);
      return;
    }
    rootsRef.current.delete(id);
  }, []);

  const setTrigger = useCallback((id: ComposerMenuId, node: HTMLElement | null) => {
    if (node) {
      triggersRef.current.set(id, node);
      return;
    }
    triggersRef.current.delete(id);
  }, []);

  useEffect(() => {
    if (!activeId) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const current = activeIdRef.current;
      if (!current) return;
      if (isInsideComposerMenuRoot(rootsRef.current.get(current) ?? null, event.target)) {
        return;
      }
      close(current);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close(activeIdRef.current ?? undefined);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [activeId, close]);

  const value = useMemo<ComposerMenuRegistryApi>(() => ({
    activeId,
    open,
    close,
    toggle,
    isOpen,
    setRoot,
    setTrigger,
  }), [activeId, close, isOpen, open, setRoot, setTrigger, toggle]);

  return React.createElement(ComposerMenuRegistryContext.Provider, { value }, children);
}

export function useComposerMenu(id: ComposerMenuId): {
  open: boolean;
  toggle: () => void;
  close: () => void;
  setRoot: (node: HTMLElement | null) => void;
  setTrigger: (node: HTMLElement | null) => void;
} {
  const registry = useContext(ComposerMenuRegistryContext);
  if (!registry) throw new Error('Composer menus require ComposerMenuRegistryProvider');
  return useMemo(() => {
    return {
      open: registry.isOpen(id),
      toggle: () => registry.toggle(id),
      close: () => registry.close(id),
      setRoot: (node: HTMLElement | null) => registry.setRoot(id, node),
      setTrigger: (node: HTMLElement | null) => registry.setTrigger(id, node),
    };
  }, [id, registry]);
}

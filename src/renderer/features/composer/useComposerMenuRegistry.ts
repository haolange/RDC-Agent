import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useOverlayDismiss } from '../../lib/overlayStack';
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
      if (next === null && current && current !== 'usage') {
        restoreFocus(current);
      }
      return next;
    });
  }, [restoreFocus]);

  const toggle = useCallback((id: ComposerMenuId) => {
    setActiveId((current) => {
      const next = reduceComposerMenu(current, { type: 'toggle', id });
      if (next === null && current === id && id !== 'usage') {
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
    if (!activeId || activeId === 'usage') return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const current = activeIdRef.current;
      if (!current || current === 'usage') return;
      if (isInsideComposerMenuRoot(rootsRef.current.get(current) ?? null, event.target)) {
        return;
      }
      close(current);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [activeId, close]);

  useOverlayDismiss(activeId !== null && activeId !== 'usage', () => close(activeIdRef.current ?? undefined), 'layout');

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

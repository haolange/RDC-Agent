import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { runContextMenuCommand, type ContextMenuCommandId } from '../lib/contextMenuCommands';
import {
  buildContextMenuItems,
  resolveContextMenuShortcuts,
  type ContextMenuItem,
  type ContextMenuLabels,
} from '../lib/contextMenuItems';
import { resolveContextMenuTarget, type ContextMenuTarget } from '../lib/contextMenuTarget';
import { useI18n } from '../i18n';
import { useClipboardBridge } from './useClipboardBridge';

export interface AppContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
  target: ContextMenuTarget;
}

export function useAppContextMenu() {
  const { t } = useI18n();
  const { copyText, readText } = useClipboardBridge();
  const [menu, setMenu] = useState<AppContextMenuState | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const targetRef = useRef<ContextMenuTarget | null>(null);

  const labels = useMemo<ContextMenuLabels>(() => ({
    undo: t('contextMenu.undo'),
    redo: t('contextMenu.redo'),
    cut: t('contextMenu.cut'),
    copy: t('contextMenu.copy'),
    paste: t('contextMenu.paste'),
    pasteSanitized: t('contextMenu.pasteSanitized'),
    selectAll: t('contextMenu.selectAll'),
  }), [t]);
  const shortcuts = useMemo(() => resolveContextMenuShortcuts(navigator.platform), []);

  const close = useCallback(() => {
    setMenu(null);
    targetRef.current = null;
    const restore = restoreFocusRef.current;
    restoreFocusRef.current = null;
    window.requestAnimationFrame(() => restore?.focus({ preventScroll: true }));
  }, []);

  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      const target = resolveContextMenuTarget(event.target);
      if (target.kind === 'none') return;
      event.preventDefault();
      event.stopPropagation();
      restoreFocusRef.current = target.element instanceof HTMLElement ? target.element : null;
      targetRef.current = target;
      const open = (clipboardText: string) => {
        setMenu({
          x: event.clientX,
          y: event.clientY,
          items: buildContextMenuItems(target, clipboardText, labels, shortcuts),
          target,
        });
      };
      if (target.writable) {
        void readText().then(open);
        return;
      }
      open('');
    };
    document.addEventListener('contextmenu', onContextMenu, true);
    return () => document.removeEventListener('contextmenu', onContextMenu, true);
  }, [labels, readText, shortcuts]);

  const onSelect = useCallback((id: ContextMenuCommandId) => {
    const target = targetRef.current;
    close();
    if (!target) return;
    void runContextMenuCommand(target, id, { copyText, readText });
  }, [close, copyText, readText]);

  return { menu, close, onSelect };
}

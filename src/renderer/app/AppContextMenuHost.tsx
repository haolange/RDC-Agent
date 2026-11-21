import React, { useRef } from 'react';
import { ContextMenu } from '../ui/ContextMenu';
import { useAppContextMenu } from '../hooks/useAppContextMenu';

export function AppContextMenuHost(): React.ReactElement | null {
  const { menu, close, onSelect } = useAppContextMenu();
  // The last menu stays rendered while its exit animation plays.
  const shown = useRef(menu);
  if (menu) shown.current = menu;
  if (!shown.current) return null;
  return (
    <ContextMenu
      open={Boolean(menu)}
      x={shown.current.x}
      y={shown.current.y}
      items={shown.current.items}
      onSelect={onSelect}
      onClose={close}
    />
  );
}

import React from 'react';
import { ContextMenu } from '../ui/ContextMenu';
import { useAppContextMenu } from '../hooks/useAppContextMenu';

export function AppContextMenuHost(): React.ReactElement | null {
  const { menu, close, onSelect } = useAppContextMenu();
  if (!menu) return null;
  return (
    <ContextMenu
      x={menu.x}
      y={menu.y}
      items={menu.items}
      onSelect={onSelect}
      onClose={close}
    />
  );
}

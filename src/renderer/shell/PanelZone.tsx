import type { ReactNode } from 'react';
import { useDynStyle } from '../lib/useDynStyle';

export interface PanelZoneProps {
  side: 'left' | 'right';
  collapsed: boolean;
  width: number;
  testId: string;
  className?: string;
  children: ReactNode;
}

export function PanelZone({
  side,
  collapsed,
  width,
  testId,
  className = '',
  children,
}: PanelZoneProps) {
  const sideClass = side === 'left' ? 'app-sidebar-left' : 'app-sidebar-right';
  const dynStyle = useDynStyle(collapsed ? {} : { width: `${width}px` });
  return (
    <aside
      data-testid={testId}
      className={`${sideClass} ${collapsed ? 'collapsed' : ''} ${className}`.trim()}
      {...dynStyle}
    >
      {children}
    </aside>
  );
}

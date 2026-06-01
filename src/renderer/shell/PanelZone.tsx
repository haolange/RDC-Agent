import type { ReactNode } from 'react';

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
  return (
    <aside
      data-testid={testId}
      className={`${sideClass} ${collapsed ? 'collapsed' : ''} ${className}`.trim()}
      style={collapsed ? undefined : { width }}
    >
      {children}
    </aside>
  );
}

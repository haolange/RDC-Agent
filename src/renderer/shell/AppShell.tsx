import type { ReactNode } from 'react';
import './AppShell.css';
import './AppShell.misc.css';

export interface AppShellProps {
  titleBar: ReactNode;
  body: ReactNode;
  overlays?: ReactNode;
}

/** Layout chrome shell; application wiring lives in `app/App`. */
export function AppShell({ titleBar, body, overlays }: AppShellProps) {
  return (
    <div className="app-container">
      {titleBar}
      {body}
      {overlays}
    </div>
  );
}

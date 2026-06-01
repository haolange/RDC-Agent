import type { ReactNode } from 'react';

export interface AppShellProps {
  titleBar: ReactNode;
  body: ReactNode;
  overlays?: ReactNode;
}

/** Layout shell skeleton — wiring happens in app/App during Phase 3. */
export function AppShell({ titleBar, body, overlays }: AppShellProps) {
  return (
    <div className="app-container">
      {titleBar}
      {body}
      {overlays}
    </div>
  );
}

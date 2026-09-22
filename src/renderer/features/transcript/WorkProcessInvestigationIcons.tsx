import type { ReactElement } from 'react';
import type { WorkProcessIconKey } from './workProcessTypes';

export function renderInvestigationIconPath(icon: WorkProcessIconKey): ReactElement | null {
  switch (icon) {
    case 'investigationRead':
      return (
        <>
          <path d="M7 3.5h7l3 3V20H7V3.5Zm7 0v3h3" />
          <circle cx="16.5" cy="16.5" r="2.2" />
          <path d="m18 18 1.6 1.6" />
        </>
      );
    case 'investigationWrite':
      return (
        <>
          <path d="M7 3.5h7l3 3V20H7V3.5Zm7 0v3h3" />
          <path d="M10 16h6M13 13v6" />
        </>
      );
    case 'investigationList':
      return (
        <>
          <path d="M7 4h10v16H7V4Z" />
          <path d="M10 8h4M10 12h4M10 16h3" />
        </>
      );
    default:
      return null;
  }
}

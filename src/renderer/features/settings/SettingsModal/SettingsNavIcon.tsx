import React from 'react';
import type { SettingsSection } from './types';

interface SettingsNavIconProps {
  section: SettingsSection;
}

export const SettingsNavIcon: React.FC<SettingsNavIconProps> = ({ section }) => {
  const content = (() => {
    switch (section) {
      case 'general':
        return (
          <>
            <path d="M5 7h14" />
            <path d="M5 12h14" />
            <path d="M5 17h14" />
            <circle cx="9" cy="7" r="1.5" />
            <circle cx="15" cy="12" r="1.5" />
            <circle cx="11" cy="17" r="1.5" />
          </>
        );
      case 'workspace':
        return (
          <>
            <path d="M4 7h6l1.7 2H20v8.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
            <path d="M4 9.5h16" />
          </>
        );
      case 'models':
        return (
          <>
            <rect x="5" y="5" width="14" height="14" rx="2.5" />
            <path d="M8.5 9h7M8.5 12h7M8.5 15h4" />
          </>
        );
      case 'agents':
        return (
          <>
            <circle cx="12" cy="8" r="3" />
            <path d="M6.5 19a5.5 5.5 0 0 1 11 0" />
            <path d="M18.5 7.5h2.5M19.75 6.25v2.5" />
          </>
        );
      case 'tools':
        return (
          <>
            <path d="M14.5 5.5 18 2.5l3.5 3.5-3 3.5" />
            <path d="M13.5 7 5 15.5 4 20l4.5-1 8.5-8.5" />
            <path d="M14.5 5.5l4 4" />
          </>
        );
      default:
        return null;
    }
  })();

  return (
    <svg className="settings-center-nav-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {content}
    </svg>
  );
};

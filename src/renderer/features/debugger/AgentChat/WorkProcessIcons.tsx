import type { FC, ReactElement } from 'react';
import type { WorkProcessIconKey } from './workProcessPresentation';

interface WorkProcessIconProps {
  icon: WorkProcessIconKey;
  className?: string;
}

const renderIconPath = (icon: WorkProcessIconKey): ReactElement => {
  switch (icon) {
    case 'brain':
      return <path d="M8 5a3 3 0 0 0-3 3v1.5A3.5 3.5 0 0 0 5.5 16 3 3 0 0 0 11 17V7.5A2.5 2.5 0 0 0 8 5Zm8 0a3 3 0 0 1 3 3v1.5a3.5 3.5 0 0 1-.5 6.5A3 3 0 0 1 13 17V7.5A2.5 2.5 0 0 1 16 5Z" />;
    case 'search':
      return <path d="M11 18a7 7 0 1 1 4.95-2.05L20 20" />;
    case 'file':
      return <path d="M7 3.5h7l3 3V20H7V3.5Zm7 0v3h3" />;
    case 'edit':
      return <path d="M5 19h4l9.5-9.5a2.1 2.1 0 0 0-3-3L6 16l-1 3Zm10-11 3 3" />;
    case 'terminal':
      return <path d="m6 8 4 4-4 4m6 0h6" />;
    case 'globe':
      return <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0 0c2.2-2.4 3.3-5.4 3.3-9S14.2 5.4 12 3m0 18c-2.2-2.4-3.3-5.4-3.3-9S9.8 5.4 12 3M3.8 9h16.4M3.8 15h16.4" />;
    case 'git':
      return <path d="M7 7a2 2 0 1 0-2 2 2 2 0 0 0 2-2Zm0 0h6a3 3 0 0 1 3 3v4m0 0a2 2 0 1 0 2 2 2 2 0 0 0-2-2Zm-11-5v5m0 0a2 2 0 1 0 2 2 2 2 0 0 0-2-2Z" />;
    case 'memory':
      return <path d="M7 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm2-3v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4M9 10h6v4H9v-4Z" />;
    case 'task':
      return <path d="M8 6h11M8 12h11M8 18h11M4 6h.01M4 12h.01M4 18h.01" />;
    case 'question':
      return <path d="M9.5 9a2.7 2.7 0 0 1 5.2.9c0 2-2.7 2.1-2.7 4.1m0 3h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />;
    case 'handoff':
      return <path d="M7 7h10l-3-3m3 3-3 3M17 17H7l3 3m-3-3 3-3" />;
    case 'spark':
      return <path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Zm6 11 .8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8L18 14Z" />;
    case 'plug':
      return <path d="M9 7V3m6 4V3M7 7h10v4a5 5 0 0 1-10 0V7Zm5 9v5" />;
    case 'monitor':
      return <path d="M4 5h16v10H4V5Zm5 15h6m-3-5v5" />;
    case 'warning':
      return <path d="M12 4 3 20h18L12 4Zm0 5v5m0 3h.01" />;
    case 'tool':
    default:
      return <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17v3h3l5.3-5.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2-2 2.5-2.5Z" />;
  }
};

export const WorkProcessIcon: FC<WorkProcessIconProps> = ({ icon, className = '' }) => (
  <svg
    className={['work-process-icon', className].filter(Boolean).join(' ')}
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {renderIconPath(icon)}
  </svg>
);

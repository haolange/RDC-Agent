import type { FC, ReactElement } from 'react';
import type { WorkProcessIconKey } from './workProcessPresentation';

interface WorkProcessIconProps {
  icon: WorkProcessIconKey;
  className?: string;
}

const renderIconPath = (icon: WorkProcessIconKey): ReactElement => {
  switch (icon) {
    case 'fileRead':
      return (
        <>
          <path d="M7 3.5h7l3 3V20H7V3.5Zm7 0v3h3" />
          <path d="M10 11h6M10 14h4" />
        </>
      );
    case 'artifactRead':
      return (
        <>
          <path d="M7 3.5h7l3 3V20H7V3.5Zm7 0v3h3" />
          <path d="M10 12h4" />
          <circle cx="16.5" cy="16.5" r="2.2" />
          <path d="m18 18 2 2" />
        </>
      );
    case 'fileWrite':
      return (
        <>
          <path d="M7 3.5h7l3 3V20H7V3.5Zm7 0v3h3" />
          <path d="M10 16h6" />
          <path d="M13 10v6" />
        </>
      );
    case 'fileEdit':
      return <path d="M5 19h4l9.5-9.5a2.1 2.1 0 0 0-3-3L6 16l-1 3Zm10-11 3 3" />;
    case 'fileDelete':
      return (
        <>
          <path d="M5 7h14" />
          <path d="M9 7V5h6v2" />
          <path d="M8 7l1 13h6l1-13" />
          <path d="M11 11v5M13 11v5" />
        </>
      );
    case 'fileMove':
      return (
        <>
          <path d="M4 8h7l2 2h7v8H4V8Z" />
          <path d="M10 14h6m0 0-2-2m2 2-2 2" />
        </>
      );
    case 'fileCopy':
      return (
        <>
          <path d="M9 8h9v12H9V8Z" />
          <path d="M6 4h9v3" />
          <path d="M6 4v12h2" />
        </>
      );
    case 'fileGlob':
      return (
        <>
          <path d="M4 7h6v6H4V7Zm10 0h6v6h-6V7ZM4 17h6v3H4v-3Zm10 0h6v3h-6v-3Z" />
        </>
      );
    case 'codeSearch':
      return (
        <>
          <path d="M8 8 5 12l3 4M16 8l3 4-3 4" />
          <path d="M13 7l-2 10" />
        </>
      );
    case 'notebookEdit':
      return (
        <>
          <path d="M6 4h12v16H6V4Z" />
          <path d="M9 4v16" />
          <path d="M12 9h4M12 13h4" />
        </>
      );
    case 'webFetch':
      return (
        <>
          <path d="M7 4h7l3 3v13H7V4Zm7 0v3h3" />
          <path d="M11 12h7m0 0-2-2m2 2-2 2" />
        </>
      );
    case 'webSearch':
      return (
        <>
          <circle cx="10.5" cy="10.5" r="5.5" />
          <path d="M14.5 14.5 19 19" />
          <path d="M8 10.5h5M10.5 8v5" />
        </>
      );
    case 'terminal':
      return <path d="m6 8 4 4-4 4m6 0h6" />;
    case 'gitStatus':
      return (
        <>
          <circle cx="7" cy="7" r="2" />
          <circle cx="17" cy="17" r="2" />
          <path d="M7 9v6a2 2 0 0 0 2 2h4" />
          <path d="M17 15V9a2 2 0 0 0-2-2h-2" />
        </>
      );
    case 'gitDiff':
      return (
        <>
          <path d="M8 5v14M16 5v14" />
          <path d="M5 9h6M13 15h6" />
        </>
      );
    case 'gitLog':
      return (
        <>
          <circle cx="8" cy="6" r="2" />
          <circle cx="8" cy="12" r="2" />
          <circle cx="8" cy="18" r="2" />
          <path d="M12 6h7M12 12h7M12 18h5" />
        </>
      );
    case 'gitAdd':
      return (
        <>
          <circle cx="8" cy="12" r="2" />
          <path d="M8 5v5m0 4v5" />
          <path d="M14 12h6m-3-3v6" />
        </>
      );
    case 'gitUnstage':
      return (
        <>
          <circle cx="8" cy="12" r="2" />
          <path d="M8 5v5m0 4v5" />
          <path d="M14 12h6" />
        </>
      );
    case 'gitCommit':
      return (
        <>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 3v6m0 6v6" />
        </>
      );
    case 'question':
      return <path d="M9.5 9a2.7 2.7 0 0 1 5.2.9c0 2-2.7 2.1-2.7 4.1m0 3h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />;
    case 'toolSearch':
      return (
        <>
          <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17v3h3l5.3-5.3" />
          <circle cx="16.5" cy="16.5" r="3.5" />
          <path d="M19 19 21.5 21.5" />
        </>
      );
    case 'handoff':
      return <path d="M7 7h10l-3-3m3 3-3 3M17 17H7l3 3m-3-3 3-3" />;
    case 'planArtifact':
      return (
        <>
          <path d="M6 4h9l3 3v13H6V4Z" />
          <path d="M9 11h6M9 14h6M9 17h3" />
          <path d="M9 8h3" />
        </>
      );
    case 'outputPublish':
      return (
        <>
          <path d="M6 4h9l3 3v13H6V4Z" />
          <path d="M15 4v3h3M9 13h6m-3-3v6" />
          <path d="m15.5 16 1.5 1.5 3-3" />
        </>
      );
    case 'memorySearch':
      return (
        <>
          <path d="M7 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" />
          <circle cx="11" cy="12" r="2.5" />
          <path d="M13 14 16 17" />
        </>
      );
    case 'memoryRead':
      return (
        <>
          <path d="M7 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" />
          <path d="M9 10h6v4H9v-4Z" />
        </>
      );
    case 'memoryWrite':
      return (
        <>
          <path d="M7 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" />
          <path d="M9 12h6M12 9v6" />
        </>
      );
    case 'memoryDelete':
      return (
        <>
          <path d="M7 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" />
          <path d="M9 12h6" />
        </>
      );
    case 'skillsList':
      return (
        <>
          <path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z" />
          <path d="M18 16h3M19.5 14.5v3" />
        </>
      );
    case 'skillRead':
      return (
        <>
          <path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z" />
          <path d="M17 18h4" />
        </>
      );
    case 'plug':
      return <path d="M9 7V3m6 4V3M7 7h10v4a5 5 0 0 1-10 0V7Zm5 9v5" />;
    case 'monitor':
      return <path d="M4 5h16v10H4V5Zm5 15h6m-3-5v5" />;
    case 'brain':
      return <path d="M8 5a3 3 0 0 0-3 3v1.5A3.5 3.5 0 0 0 5.5 16 3 3 0 0 0 11 17V7.5A2.5 2.5 0 0 0 8 5Zm8 0a3 3 0 0 1 3 3v1.5a3.5 3.5 0 0 1-.5 6.5A3 3 0 0 1 13 17V7.5A2.5 2.5 0 0 1 16 5Z" />;
    case 'taskCreate':
      return (
        <>
          <path d="M8 6h11M8 12h11M8 18h8" />
          <path d="M4 6h.01M4 12h.01M4 18h.01" />
          <path d="M19 16v4m-2-2h4" />
        </>
      );
    case 'taskUpdate':
      return (
        <>
          <path d="M8 6h11M8 12h11M8 18h11" />
          <path d="M4 6h.01M4 12h.01M4 18h.01" />
          <path d="M18 15l2 2-2 2" />
        </>
      );
    case 'taskGet':
      return (
        <>
          <path d="M8 6h11M8 12h7M8 18h11" />
          <path d="M4 6h.01M4 12h.01M4 18h.01" />
          <path d="M16 11v4h3" />
        </>
      );
    case 'taskList':
      return <path d="M8 6h11M8 12h11M8 18h11M4 6h.01M4 12h.01M4 18h.01" />;
    case 'taskStop':
      return (
        <>
          <path d="M8 6h11M8 12h11M8 18h11" />
          <path d="M4 6h.01M4 12h.01M4 18h.01" />
          <rect x="16" y="15" width="4" height="4" rx="0.5" />
        </>
      );
    case 'imageRead':
      return (
        <>
          <path d="M5 6h14v12H5V6Z" />
          <path d="m5 15 4-4 3 3 2-2 5 5" />
          <circle cx="9" cy="10" r="1" />
        </>
      );
    case 'interpreter':
      return (
        <>
          <path d="M6 5h12v14H6V5Z" />
          <path d="M9 9h6M9 12h4" />
          <path d="M9 16h2" />
        </>
      );
    case 'spark':
      return <path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Zm6 11 .8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8L18 14Z" />;
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

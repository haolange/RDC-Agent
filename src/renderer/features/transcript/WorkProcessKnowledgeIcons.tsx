import type { ReactElement } from 'react';
import type { WorkProcessIconKey } from './workProcessPresentation';

export function renderKnowledgeIconPath(icon: WorkProcessIconKey): ReactElement | null {
  switch (icon) {
    case 'knowledgeBrowse':
      return (
        <>
          <path d="M5 6h6v13H6a1 1 0 0 1-1-1V6Z" />
          <path d="M13 6h6v12a1 1 0 0 1-1 1h-5V6Z" />
          <path d="M8 9h2M15 9h2" />
        </>
      );
    case 'knowledgeSearch':
      return (
        <>
          <path d="M5 6h8v13H6a1 1 0 0 1-1-1V6Z" />
          <circle cx="16.5" cy="10.5" r="2.5" />
          <path d="m18.2 12.7 2.3 2.3" />
        </>
      );
    case 'knowledgeRead':
      return (
        <>
          <path d="M5 6h8v13H6a1 1 0 0 1-1-1V6Z" />
          <path d="M15 8h5M15 11h5M15 14h3" />
        </>
      );
    case 'knowledgeCompile':
      return (
        <>
          <path d="M5 6h8v13H6a1 1 0 0 1-1-1V6Z" />
          <path d="M15 8h5l-1.5 3H20l-5 6v-4h-2l2-5Z" />
        </>
      );
    case 'knowledgeCandidate':
      return (
        <>
          <path d="M5 6h8v13H6a1 1 0 0 1-1-1V6Z" />
          <path d="M16 9h4M18 7v4" />
          <path d="M15 15h5" />
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
    default:
      return null;
  }
}

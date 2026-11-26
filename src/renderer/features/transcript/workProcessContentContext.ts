import { createContext, useContext, type ComponentType, type ReactNode } from 'react';
import type { WorkProcessPresentation, WorkProcessRow } from './workProcessTypes';

export interface WorkProcessContentProps {
  presentation: WorkProcessPresentation;
  sessionId?: string | null;
  renderToolDetail?: (row: Extract<WorkProcessRow, { type: 'tool' }>) => ReactNode;
  disclosureScope?: string;
  density?: 'normal' | 'compact';
  /** The enclosing disclosure already supplies the leading content inset. */
  embedded?: boolean;
  leadingContent?: ReactNode;
  /** The owning turn or delegation is still running; under the `latest` preference it follows the newest step. */
  active: boolean;
}

/**
 * A delegation's row nests the same process body that renders it. The body hands itself down through this context,
 * so the rows it renders never import it back.
 */
export const WorkProcessContentContext = createContext<ComponentType<WorkProcessContentProps> | null>(null);

export function useNestedWorkProcessContent(): ComponentType<WorkProcessContentProps> {
  const content = useContext(WorkProcessContentContext);
  if (!content) throw new Error('A delegation row renders only inside a work process body.');
  return content;
}
